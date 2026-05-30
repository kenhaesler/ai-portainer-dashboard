/** A React Flow handle position on a topology node. */
export type HandleDirection = 'top' | 'right' | 'bottom' | 'left';

/**
 * Whether a node should render the handle in direction `id`.
 *
 * `usedHandles` is the set of directions edges actually attach to for this node
 * (injected onto node data by the topology graph). When it is `undefined` — no
 * data supplied — all handles render as a safe fallback; an explicit empty array
 * renders none. Pure; exported for testing.
 */
export function shouldShowHandle(
  usedHandles: HandleDirection[] | undefined,
  id: HandleDirection,
): boolean {
  return usedHandles === undefined || usedHandles.includes(id);
}
