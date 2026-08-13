/**
 * Security Regression — Dependency advisories
 *
 * CI deliberately does not install or audit the separate loadtests tree. Keep
 * repository-local guards for published vulnerable ranges that have already
 * reached its committed lockfile.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonObject = Record<string, unknown>;
type Semver = [major: number, minor: number, patch: number];

interface VulnerableRange {
  advisory: string;
  introduced?: string;
  fixed: string;
}

interface DependencyAdvisory {
  packageName: string;
  vulnerableRanges: VulnerableRange[];
}

const DEPENDENCY_ADVISORIES: DependencyAdvisory[] = [
  {
    packageName: 'js-yaml',
    vulnerableRanges: [
      { advisory: 'GHSA-5p4m-2wfm-xmqj', introduced: '3.0.0', fixed: '3.15.1' },
      { advisory: 'GHSA-5p4m-2wfm-xmqj', introduced: '4.0.0', fixed: '4.3.1' },
      { advisory: 'GHSA-724g-mxrg-4qvm', introduced: '5.0.0', fixed: '5.2.1' },
    ],
  },
  {
    packageName: 'nanoid',
    vulnerableRanges: [
      { advisory: 'GHSA-2v37-7h3g-55p8 / CVE-2026-67213', fixed: '3.3.18' },
      {
        advisory: 'GHSA-2v37-7h3g-55p8 / CVE-2026-67213',
        introduced: '4.0.0',
        fixed: '5.1.6',
      },
    ],
  },
];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadtestPackages(): JsonObject {
  const lockPath = path.resolve(process.cwd(), '..', 'loadtests', 'package-lock.json');
  const parsed: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));

  if (!isJsonObject(parsed) || !isJsonObject(parsed.packages)) {
    throw new Error('loadtests/package-lock.json does not contain a packages object');
  }

  return parsed.packages;
}

function parseSemver(version: string): Semver {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`unsupported dependency version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: Semver, right: Semver): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function isInVulnerableRange(version: string, range: VulnerableRange): boolean {
  const target = parseSemver(version);
  const atOrAfterIntroduction =
    range.introduced === undefined || compareSemver(target, parseSemver(range.introduced)) >= 0;
  return atOrAfterIntroduction && compareSemver(target, parseSemver(range.fixed)) < 0;
}

function copiesOf(packages: JsonObject, packageName: string) {
  const suffix = `node_modules/${packageName}`;

  return Object.entries(packages).flatMap(([packagePath, entry]) => {
    if (packagePath !== suffix && !packagePath.endsWith(`/${suffix}`)) return [];
    if (!isJsonObject(entry) || typeof entry.version !== 'string') {
      throw new Error(`${packagePath} does not contain a string version`);
    }
    return [{ packagePath, version: entry.version }];
  });
}

describe('load-test dependency advisories', () => {
  const packages = loadtestPackages();

  it.each([
    { packageName: 'js-yaml', version: '3.15.0', expected: true },
    { packageName: 'js-yaml', version: '3.15.1', expected: false },
    { packageName: 'js-yaml', version: '4.3.0', expected: true },
    { packageName: 'js-yaml', version: '4.3.1', expected: false },
    { packageName: 'js-yaml', version: '5.2.0', expected: true },
    { packageName: 'js-yaml', version: '5.2.1', expected: false },
    { packageName: 'nanoid', version: '3.3.17', expected: true },
    { packageName: 'nanoid', version: '3.3.18', expected: false },
    { packageName: 'nanoid', version: '4.0.0', expected: true },
    { packageName: 'nanoid', version: '5.1.5', expected: true },
    { packageName: 'nanoid', version: '5.1.6', expected: false },
  ])('$packageName@$version vulnerable: $expected', ({ packageName, version, expected }) => {
    const dependency = DEPENDENCY_ADVISORIES.find((entry) => entry.packageName === packageName);
    if (!dependency) throw new Error(`${packageName} is missing advisory metadata`);

    expect(dependency.vulnerableRanges.some((range) => isInVulnerableRange(version, range))).toBe(
      expected,
    );
  });

  it.each(DEPENDENCY_ADVISORIES)(
    '$packageName stays outside every known vulnerable range',
    ({ packageName, vulnerableRanges }) => {
      const copies = copiesOf(packages, packageName);

      expect(copies.length, `${packageName} disappeared from the load-test tree`).toBeGreaterThan(0);
      for (const { packagePath, version } of copies) {
        const matched = vulnerableRanges.filter((range) => isInVulnerableRange(version, range));
        expect(
          matched.map(({ advisory, introduced, fixed }) =>
            `${advisory}: ${introduced === undefined ? '' : `>=${introduced}, `}<${fixed}`,
          ),
          `${packagePath} resolves ${packageName}@${version} inside a known vulnerable range`,
        ).toEqual([]);
      }
    },
  );
});
