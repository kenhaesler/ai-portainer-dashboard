/**
 * Verifies that the PWA icon assets referenced in vite.config.ts exist in
 * public/ and are valid PNG files. Missing icons cause 404s in the browser
 * and Lighthouse PWA audit failures.
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(__dirname, '../public');

function isPng(filePath: string): boolean {
  const buf = readFileSync(filePath);
  // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

describe('PWA icons', () => {
  it('icon-192.png exists and is a valid PNG', () => {
    const iconPath = resolve(publicDir, 'icon-192.png');
    expect(existsSync(iconPath), `${iconPath} should exist`).toBe(true);
    expect(statSync(iconPath).size, 'icon-192.png should not be empty').toBeGreaterThan(0);
    expect(isPng(iconPath), 'icon-192.png should have PNG magic bytes').toBe(true);
  });

  it('icon-512.png exists and is a valid PNG', () => {
    const iconPath = resolve(publicDir, 'icon-512.png');
    expect(existsSync(iconPath), `${iconPath} should exist`).toBe(true);
    expect(statSync(iconPath).size, 'icon-512.png should not be empty').toBeGreaterThan(0);
    expect(isPng(iconPath), 'icon-512.png should have PNG magic bytes').toBe(true);
  });

  it('icon-192.png is larger than icon-512.png by file size ratio < 1', () => {
    // 192px icon should be smaller than 512px icon
    const size192 = statSync(resolve(publicDir, 'icon-192.png')).size;
    const size512 = statSync(resolve(publicDir, 'icon-512.png')).size;
    expect(size192).toBeLessThan(size512);
  });
});
