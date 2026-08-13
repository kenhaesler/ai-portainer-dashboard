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
    {
      packageName: 'js-yaml',
      patchedFloor: '3.15.1',
      advisory: 'GHSA-5p4m-2wfm-xmqj',
    },
    {
      packageName: 'nanoid',
      patchedFloor: '3.3.18',
      advisory: 'GHSA-2v37-7h3g-55p8 / CVE-2026-67213',
    },
  ])('$packageName stays outside $advisory', ({ packageName, patchedFloor, advisory }) => {
    const copies = copiesOf(packages, packageName);

    expect(copies.length, `${packageName} disappeared from the load-test tree`).toBeGreaterThan(0);
    for (const { packagePath, version } of copies) {
      expect(
        compareSemver(parseSemver(version), parseSemver(patchedFloor)),
        `${packagePath} resolves ${packageName}@${version}, which is below the ${advisory} ` +
          `patched floor ${patchedFloor}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
});
