import { describe, it, expect } from 'vitest';
import { readProductVersion } from '../app.js';

describe('readProductVersion', () => {
  it('returns a non-empty semver string read from the working-dir package.json', () => {
    const version = readProductVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
    // A real package.json version, not the "unknown" fallback.
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
