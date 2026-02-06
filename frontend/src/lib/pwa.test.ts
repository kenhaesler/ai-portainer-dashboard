import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('PWA configuration', () => {
  const viteConfig = readFileSync(
    resolve(__dirname, '../../vite.config.ts'),
    'utf-8',
  );

  it('has VitePWA plugin configured', () => {
    expect(viteConfig).toContain("VitePWA");
    expect(viteConfig).toContain("registerType: 'autoUpdate'");
  });

  it('configures NetworkFirst for API routes', () => {
    expect(viteConfig).toContain("'api-cache'");
    expect(viteConfig).toContain("'NetworkFirst'");
  });

  it('configures CacheFirst for images', () => {
    expect(viteConfig).toContain("'image-cache'");
    expect(viteConfig).toContain("'CacheFirst'");
  });

  it('configures StaleWhileRevalidate for static assets', () => {
    expect(viteConfig).toContain("'static-cache'");
    expect(viteConfig).toContain("'StaleWhileRevalidate'");
  });

  it('includes PWA manifest with app name', () => {
    expect(viteConfig).toContain("'AI Portainer Dashboard'");
    expect(viteConfig).toContain("display: 'standalone'");
  });
});
