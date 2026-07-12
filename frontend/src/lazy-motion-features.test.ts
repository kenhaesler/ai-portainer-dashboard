import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the LazyMotion payload optimization (#1507).
 *
 * App.tsx wraps the tree in `<LazyMotion features={...}>` with an async
 * feature loader so the framer-motion animation machinery loads in its own
 * chunk, off the startup critical path. That only works when every animated
 * component uses the lightweight `m` component: importing the full `motion`
 * component from 'framer-motion' bundles the complete featureset into whatever
 * chunk imports it, silently defeating LazyMotion for the whole app.
 *
 * jsdom cannot observe bundling, so — mirroring native-control-color-scheme
 * .test.ts — these tests scan the source tree and fail loudly when a full
 * `motion` import sneaks back in or App.tsx regresses to synchronous features.
 */

const srcDir = path.resolve(process.cwd(), 'src');

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(abs));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      results.push(abs);
    }
  }
  return results;
}

/** Matches `motion` as a named binding in a framer-motion import statement. */
function importsFullMotion(source: string): boolean {
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]framer-motion['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    const bindings = match[1].split(',').map((b) => b.trim().split(/\s+as\s+/)[0].trim());
    if (bindings.includes('motion')) return true;
  }
  return false;
}

describe('LazyMotion feature bundling (#1507)', () => {
  it('no non-test source file imports the full `motion` component from framer-motion', () => {
    const offenders = collectSourceFiles(srcDir)
      .filter((file) => importsFullMotion(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(srcDir, file));

    expect(
      offenders,
      `Use \`import { m } from 'framer-motion'\` (with LazyMotion features) instead of the full \`motion\` component in: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('App.tsx loads motion features asynchronously (no static domAnimation/domMax import)', () => {
    const appSource = fs.readFileSync(path.join(srcDir, 'App.tsx'), 'utf8');

    // The feature bundle must come from the dedicated lazy module...
    expect(appSource).toMatch(/import\(['"]\.\/lib\/motion-features['"]\)/);
    // ...never from a static framer-motion import, which would put it back on
    // the entry-critical path.
    expect(appSource).not.toMatch(/import\s*\{[^}]*\bdom(Animation|Max)\b[^}]*\}\s*from\s*['"]framer-motion['"]/);
  });

  it('the feature bundle is domMax — sidebar layout/layoutId animations require it', () => {
    const featuresSource = fs.readFileSync(path.join(srcDir, 'lib/motion-features.ts'), 'utf8');
    expect(featuresSource).toMatch(/import\s*\{\s*domMax\s*\}\s*from\s*['"]framer-motion['"]/);
    expect(featuresSource).toMatch(/export\s+default\s+domMax/);
  });
});
