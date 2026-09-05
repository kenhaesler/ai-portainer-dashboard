import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { resolveConfig } from 'vite';

describe('contracts imports on a clean checkout', () => {
  it.each(['vite.config.ts', 'vitest.config.ts'])('%s resolves the shared vocabulary to source, not unbuilt dist', async (file) => {
    const root = resolve(import.meta.dirname, '..');
    const config = await resolveConfig({ root, configFile: resolve(root, file) }, 'serve');
    const alias = config.resolve.alias.find((entry) => entry.find === '@dashboard/contracts');
    expect(alias?.replacement).toBe(resolve(root, '../packages/contracts/src/index.ts'));
  }, 30_000);
});
