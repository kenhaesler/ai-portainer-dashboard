import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import vm from 'node:vm';
import { PRODUCT_NAME } from './product';

interface RuntimeRule {
  urlPattern: RegExp;
  handler: string;
  options?: { cacheName?: string };
}
interface PwaOptions {
  registerType?: string;
  workbox: {
    importScripts?: string[];
    navigateFallbackDenylist?: RegExp[];
    runtimeCaching: RuntimeRule[];
  };
  manifest: { name: string; short_name: string; display: string };
}

// Capture the options the shipped vite.config.ts hands to VitePWA, so the
// assertions run against the real config rather than its source text.
const captured = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock('vite-plugin-pwa', () => ({
  VitePWA: (options: unknown) => {
    captured.options = options;
    return { name: 'mock-pwa' };
  },
}));

describe('PWA configuration', () => {
  let pwa: PwaOptions;

  beforeAll(async () => {
    await import('../../../vite.config');
    pwa = captured.options as PwaOptions;
  });

  /** Workbox matches RegExp routes against the full URL; the first matching route wins. */
  const firstMatch = (href: string) =>
    pwa.workbox.runtimeCaching.find((rule) => {
      rule.urlPattern.lastIndex = 0;
      return rule.urlPattern.test(href);
    });

  it('has VitePWA plugin configured', () => {
    expect(pwa.registerType).toBe('autoUpdate');
  });

  it.each([
    'https://dash.example.com/api/containers',
    'http://localhost:8080/api/auth/me?x=1',
    'https://dash.example.com/api/images/logo.png',
    'https://dash.example.com/api/export/report.js',
    'https://dash.example.com/socket.io/?EIO=4&transport=polling',
    'https://dash.example.com/socket.io/socket.io.js',
  ])('serves %s network-only, never from a cache', (href) => {
    expect(firstMatch(href)?.handler).toBe('NetworkOnly');
  });

  it('has no runtime cache named api-cache', () => {
    const names = pwa.workbox.runtimeCaching.map((r) => r.options?.cacheName);
    expect(names).not.toContain('api-cache');
  });

  it('denies /api and /socket.io as navigation fallbacks', () => {
    const deny = pwa.workbox.navigateFallbackDenylist ?? [];
    expect(deny.some((re) => re.test('/api/containers'))).toBe(true);
    expect(deny.some((re) => re.test('/socket.io/'))).toBe(true);
    expect(deny.some((re) => re.test('/containers'))).toBe(false);
  });

  it('configures CacheFirst for images', () => {
    const rule = firstMatch('https://dash.example.com/icon-192.png');
    expect(rule?.options?.cacheName).toBe('image-cache');
    expect(rule?.handler).toBe('CacheFirst');
  });

  it('configures StaleWhileRevalidate for static assets', () => {
    const rule = firstMatch('https://dash.example.com/entries/index-abc.js');
    expect(rule?.options?.cacheName).toBe('static-cache');
    expect(rule?.handler).toBe('StaleWhileRevalidate');
  });

  it('derives the manifest name from PRODUCT_NAME', () => {
    expect(pwa.manifest.name).toBe(PRODUCT_NAME);
    expect(pwa.manifest.short_name).toBe(PRODUCT_NAME);
    expect(pwa.manifest.display).toBe('standalone');
  });

  describe('legacy api-cache migration', () => {
    const script = () => {
      const entry = pwa.workbox.importScripts?.find((s) => s.includes('pwa-cache-migration'));
      expect(entry, 'importScripts should reference the migration script').toBeDefined();
      return readFileSync(resolve(__dirname, '../../../public', entry!.replace(/^\//, '')), 'utf-8');
    };

    it('deletes api-cache when the service worker activates', async () => {
      const handlers: Record<string, (e: { waitUntil: (p: Promise<unknown>) => void }) => void> = {};
      const deleted: string[] = [];
      const self = { addEventListener: (type: string, fn: never) => { handlers[type] = fn; } };
      const caches = { delete: async (name: string) => { deleted.push(name); return true; } };
      vm.runInNewContext(script(), { self, caches });

      let pending: Promise<unknown> | undefined;
      handlers.activate({ waitUntil: (p) => { pending = p; } });
      await pending;
      expect(deleted).toEqual(['api-cache']);
    });
  });
});
