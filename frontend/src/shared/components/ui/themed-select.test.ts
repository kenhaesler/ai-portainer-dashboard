import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for the Radix Select popper anchoring fix (#1560).
 *
 * The Workload Explorer filter dropdowns (ThemedSelect) intermittently rendered
 * at viewport (0,0) when opened during AppLayout's entrance transform. Radix
 * Select snapshots the trigger rect once at open time; Floating UI's default
 * autoUpdate does not observe an ancestor CSS-transform transition, so the panel
 * never re-anchors after the transform settles. `updatePositionStrategy="always"`
 * passes `animationFrame: true` to autoUpdate, re-anchoring every frame while
 * open so a mid-animation open self-corrects.
 *
 * jsdom has no layout engine, so it cannot exercise popper positioning; mirroring
 * `native-control-color-scheme.test.ts`, we read the source and assert the prop is
 * present, failing loudly if it is ever removed.
 */
const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/shared/components/ui/themed-select.tsx'),
  'utf8',
);

describe('ThemedSelect popper anchoring (#1560)', () => {
  it('renders the Select content as a popper', () => {
    expect(source).toContain('position="popper"');
  });

  it('keeps the panel re-anchored to the trigger while open', () => {
    expect(source).toContain('updatePositionStrategy="always"');
  });
});
