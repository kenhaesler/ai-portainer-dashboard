import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRODUCT_NAME } from './product';

const SRC_ROOT = resolve(__dirname, '../..');

describe('PRODUCT_NAME', () => {
  it('is the name PRODUCT.md and the compose project already use', () => {
    expect(PRODUCT_NAME).toBe('Container Insights');
  });

  /**
   * The point of the constant is that no surface hardcodes a rival name. This
   * is scoped to the sign-in / status surfaces, which is what this change owns;
   * the remaining call sites (`sidebar.tsx`, `tab-general.tsx`, `index.html`,
   * the PWA manifest in `vite.config.ts`) are owned by other work and are
   * listed as hand-offs. Widen this list as they adopt the constant.
   */
  it('is the only product name in the sign-in and status surfaces', () => {
    const owned = [
      join(SRC_ROOT, 'features', 'core', 'pages', 'login.tsx'),
      join(SRC_ROOT, 'features', 'core', 'pages', 'auth-callback.tsx'),
      join(SRC_ROOT, 'features', 'observability', 'pages', 'status-page.tsx'),
    ];

    for (const file of owned) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} hardcodes a rival product name`).not.toMatch(
        /Docker Insights?\b/
      );
    }
  });
});
