import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), 'utf-8')) as T;
}

interface LockEntry {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Lockfile {
  packages: Record<string, LockEntry>;
}

interface RootManifest {
  overrides?: Record<string, unknown>;
}

type Semver = [number, number, number];

const EXACT = /^\d+\.\d+\.\d+$/;
const CARET = /^\^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): Semver {
  const m = EXACT.exec(version);
  if (!m) throw new Error(`unsupported version shape: ${version}`);
  const [major, minor, patch] = version.split('.').map(Number);
  return [major, minor, patch];
}

const compare = (a: Semver, b: Semver): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** `^a.b.c` upper bound, including npm's 0.x narrowing. */
const caretCeiling = ([major, minor, patch]: Semver): Semver =>
  major > 0 ? [major + 1, 0, 0] : minor > 0 ? [0, minor + 1, 0] : [0, 0, patch + 1];

/**
 * Exact (`1.33.0`) and caret (`^1.33.0`) are the only shapes this dependency
 * has ever been declared with. Anything else throws rather than guessing — a
 * range this file cannot read must fail loudly, not be silently treated as
 * satisfied, which is the failure mode that lets a stale override survive.
 */
function satisfies(version: string, range: string): boolean {
  if (EXACT.test(range)) return range === version;
  const caret = CARET.exec(range);
  if (!caret) throw new Error(`unsupported range shape: ${range}`);
  const floor = parse(`${caret[1]}.${caret[2]}.${caret[3]}`);
  const target = parse(version);
  return compare(target, floor) >= 0 && compare(target, caretCeiling(floor)) < 0;
}

/**
 * The `lightningcss` override (#1631).
 *
 * vite 8.2.0 needs `lightningcss ^1.33.0`; `@tailwindcss/node` pins it at
 * exactly `1.32.0`. Left alone, npm installs both, and that is not merely
 * wasteful — it breaks the lockfile-integrity gate. lightningcss 1.33.0 added
 * `libc` metadata to its platform bindings and 1.32.0 has none, so on a glibc
 * runner the hoisted `lightningcss-linux-x64-musl@1.32.0` installs (nothing
 * filters it) while the nested `@1.33.0` musl binding is correctly skipped.
 * `npm ls --all` then resolves the nested copy's binding up to the hoisted
 * 1.32.0 and reports `invalid`, failing CI on a package neither version would
 * ever load on that machine.
 *
 * The override collapses the tree to one lightningcss, so there is nothing left
 * to shadow. It deliberately violates tailwind's exact pin — a minor bump of a
 * build-time CSS transformer, verified by a passing `npm run build -w frontend`.
 * lightningcss is dev-only; it is absent from the runtime image.
 *
 * Drop it as soon as upstream agrees on a version — the first test here fails
 * when that happens, per the same "drop each override once the upstream range
 * moves past it" rule the `loadtests/` overrides carry in CLAUDE.md.
 *
 * Deliberately NOT covered here:
 *   • whether lightningcss 1.33.0 emits byte-identical CSS to 1.32.0 — a build
 *     proves the binding API is compatible, not that output never shifts
 *   • the duplicate vite (root 8.1.5 for vitest, frontend 8.2.0 for builds).
 *     Two vite copies are legal; only the binding shadow above breaks the gate.
 */
describe('lightningcss override (#1631)', () => {
  const manifest = readJson<RootManifest>('package.json');
  const lock = readJson<Lockfile>('package-lock.json');

  const declared = manifest.overrides?.lightningcss;
  const override = typeof declared === 'string' ? declared : '';

  const requirements = Object.entries(lock.packages).flatMap(([path, entry]) => {
    const range = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    }.lightningcss;
    return range ? [{ path, range }] : [];
  });

  const copies = Object.entries(lock.packages).filter(([path]) =>
    /(^|\/)node_modules\/lightningcss$/.test(path),
  );

  it('is still needed — the declared ranges cannot agree on a version by themselves', () => {
    // The tripwire. An override that outlives its conflict is invisible debt:
    // it silently holds a transitive dependency back for every consumer.
    const distinct = [...new Set(requirements.map((r) => r.range))];
    const exactPins = distinct.filter((range) => EXACT.test(range));
    const agreeable =
      distinct.length <= 1 ||
      exactPins.some((pin) => requirements.every((r) => satisfies(pin, r.range)));

    expect(
      agreeable,
      `declared lightningcss ranges now agree (${distinct.join(', ') || 'none left'}) — ` +
        'delete overrides.lightningcss from the root package.json, re-run npm install, ' +
        'drop its note from CLAUDE.md, and delete this file',
    ).toBe(false);
  });

  it('collapses the tree to a single lightningcss', () => {
    // A second copy re-creates the platform-binding shadow that fails
    // `npm ls --all`, which is the whole reason the override exists.
    expect(
      copies.map(([path]) => path),
      'more than one lightningcss in the tree — the override stopped applying',
    ).toHaveLength(1);
    expect(copies[0]?.[1].version).toBe(override);
  });

  it('pins a version every caret range in the tree accepts', () => {
    // Exact pins are what the override exists to break; caret ranges are not.
    // Forcing a version below one of them would trade a lockfile error for a
    // genuinely unsupported dependency.
    expect(override, 'pin an exact version so the tree stays deterministic').toMatch(EXACT);

    for (const { path, range } of requirements.filter((r) => CARET.test(r.range))) {
      expect(
        satisfies(override, range),
        `${path} declares lightningcss ${range}, which the override ${override} does not satisfy`,
      ).toBe(true);
    }
  });
});
