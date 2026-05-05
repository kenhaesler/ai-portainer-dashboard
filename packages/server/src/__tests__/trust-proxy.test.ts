import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveTrustProxy } from '../app.js';

/**
 * Unit tests for resolveTrustProxy() (#1099).
 *
 * resolveTrustProxy() turns the comma-separated `TRUSTED_PROXY_IPS` env value
 * into the shape Fastify's `trustProxy` option expects (`true` | `string[]`).
 * Reviewer (gh-pr-reviewer) flagged the function as exported without direct
 * unit coverage. These tests pin the contract:
 *
 *   - undefined / empty  → `true` (the safe default behind nginx)
 *   - one or more CIDRs  → `string[]`
 *   - whitespace         → trimmed
 *   - invalid entries    → logged-and-skipped (warn), never crash
 *   - all-invalid input  → fall back to `true` with warning
 */
describe('resolveTrustProxy', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress + capture the `console.warn` calls the function emits.
    // It uses console.warn (not the Fastify logger) because it runs before
    // the logger is configured — see app.ts:124.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns true when value is undefined (default behaviour)', () => {
    // The production stack always runs behind nginx, so the safe default is
    // to trust X-Forwarded-* unconditionally. See app.ts:103.
    expect(resolveTrustProxy(undefined)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns true when value is an empty string (treated as unset)', () => {
    expect(resolveTrustProxy('')).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns true when value is whitespace-only (treated as unset)', () => {
    // Empty after trim — same code path as the empty-string case.
    expect(resolveTrustProxy('   ')).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns single-element array for one CIDR', () => {
    expect(resolveTrustProxy('172.16.0.0/12')).toEqual(['172.16.0.0/12']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns array of CIDRs for comma-separated list', () => {
    expect(resolveTrustProxy('172.16.0.0/12,10.0.0.0/8')).toEqual([
      '172.16.0.0/12',
      '10.0.0.0/8',
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts a plain IPv4 address (no CIDR mask)', () => {
    expect(resolveTrustProxy('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts an IPv6 address with mask', () => {
    // The regex deliberately accepts loose IPv6 forms — proxy-addr does the
    // authoritative parsing downstream (app.ts:116).
    expect(resolveTrustProxy('::1')).toEqual(['::1']);
    expect(resolveTrustProxy('fc00::/7')).toEqual(['fc00::/7']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from each entry', () => {
    expect(resolveTrustProxy('  172.16.0.0/12 ,  10.0.0.0/8  ')).toEqual([
      '172.16.0.0/12',
      '10.0.0.0/8',
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('drops empty entries from doubled commas', () => {
    // ',,' produces empty strings after split — they are filtered out before
    // validation, so they do NOT trigger the invalid-entry warning.
    expect(resolveTrustProxy('172.16.0.0/12,,10.0.0.0/8')).toEqual([
      '172.16.0.0/12',
      '10.0.0.0/8',
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips invalid CIDR entry with a warning (does not throw)', () => {
    // Behaviour pinned: invalid entries are logged-and-skipped, not fatal.
    // See app.ts:107 ("conservative path: visibility-with-best-effort").
    const result = resolveTrustProxy('not-a-cidr');

    // All entries invalid → falls back to trustProxy=true with a second warn.
    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring invalid TRUSTED_PROXY_IPS entry'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('falling back to trustProxy=true'),
    );
  });

  it('keeps valid entries and warns on invalids in a mixed list', () => {
    const result = resolveTrustProxy('172.16.0.0/12,not-a-cidr,10.0.0.0/8');

    // Valid CIDRs retained in input order; invalid entry dropped.
    expect(result).toEqual(['172.16.0.0/12', '10.0.0.0/8']);

    // Exactly one "invalid entry" warning, no fallback warning (we have valids).
    const calls = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.filter((m: string) => m.includes('Ignoring invalid'))).toHaveLength(1);
    expect(calls.some((m: string) => m.includes('not-a-cidr'))).toBe(true);
    expect(calls.some((m: string) => m.includes('falling back'))).toBe(false);
  });
});
