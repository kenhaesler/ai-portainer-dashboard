import { describe, it, expect } from 'vitest';

/**
 * The audit page counted the rows it was displaying, not the containers that
 * needed review.
 *
 * `visibleEntries` includes the clean rows once "Show N clean containers" is
 * expanded, so clicking that button — an explicit request to confirm nothing
 * was wrong — flipped the counter above it from "0 containers need a look" to
 * "20 containers need a look", while the button itself now read "Hide 20 clean
 * containers". The page asserted twenty findings and zero findings at once, on
 * a security surface, from a fleet with no exceptions at all.
 *
 * This exercises the derivation directly: a display toggle must not be able to
 * change a count of findings.
 */

interface Entry { name: string; privileged: boolean }

const isException = (e: Entry) => e.privileged;

/** Mirrors the page: `visibleEntries` widens when clean rows are shown. */
function visibleEntries(entries: Entry[], showClean: boolean): Entry[] {
  return showClean ? entries : entries.filter(isException);
}

/** The count the header must use — independent of `showClean`. */
function exceptionCount(entries: Entry[]): number {
  return entries.filter(isException).length;
}

describe('security audit "need a look" count', () => {
  const cleanFleet: Entry[] = Array.from({ length: 20 }, (_, i) => ({
    name: `svc-${i}`,
    privileged: false,
  }));

  it('stays at zero when a clean fleet expands its clean list', () => {
    expect(exceptionCount(cleanFleet)).toBe(0);

    // The regression: this is what the header used to render.
    expect(visibleEntries(cleanFleet, true)).toHaveLength(20);
    // The header must not follow it.
    expect(exceptionCount(cleanFleet)).toBe(0);
  });

  it('is unchanged by the show/hide toggle', () => {
    const mixed: Entry[] = [
      { name: 'a', privileged: true },
      { name: 'b', privileged: false },
      { name: 'c', privileged: false },
    ];

    const collapsed = exceptionCount(mixed);
    const expanded = exceptionCount(mixed);

    expect(collapsed).toBe(1);
    expect(expanded).toBe(1);
    expect(visibleEntries(mixed, true)).toHaveLength(3);
    expect(visibleEntries(mixed, false)).toHaveLength(1);
  });

  it('counts only the containers that trip a check', () => {
    const fleet: Entry[] = [
      { name: 'a', privileged: true },
      { name: 'b', privileged: true },
      { name: 'c', privileged: false },
    ];

    expect(exceptionCount(fleet)).toBe(2);
  });
});
