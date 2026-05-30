# Topology — Prune Unused Connection Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only the React Flow handles each topology node actually uses (derived from the edge list), instead of all four, on both container and network nodes.

**Architecture:** A pure helper `collectUsedHandles(edges)` maps each nodeId → set of used handle directions. Phase 4 of `topology-graph.tsx` injects `usedHandles: HandleDirection[]` onto each `node.data` after edges are built. `ContainerNode` / `NetworkNode` render a `<Handle>` only when its id is in `usedHandles` (fallback: render all four when `usedHandles` is `undefined`).

**Tech Stack:** React 19, `@xyflow/react`, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-30-topology-prune-unused-handles-design.md`

---

## Conventions
- Worktree: `/home/simon/Documents/ai-portainer-dashboard/.claude/worktrees/feature+topology-prune-unused-handles`, branch `feature/topology-prune-unused-handles` (off `origin/dev` 65cf3383).
- Run frontend tests from `frontend/`: `cd frontend && npx vitest run <path>` (NOT worktree root → jsdom error). `--pool=threads` if workers fail.
- Never `git add -A`/`-u` (node_modules symlinks). Never `--no-verify`. Husky pre-commit prints a big `npm ci --dry-run` dump — harmless; pipe commits to a file and grep, don't cat.

## File Structure
- Modify `frontend/src/features/containers/components/network/topology-graph.tsx` — export `HandleDirection`, add `collectUsedHandles`, inject `usedHandles` in Phase 4.
- Modify `container-node.tsx`, `network-node.tsx` — conditional handle render.
- Modify `topology-graph.test.ts` — tests for `collectUsedHandles`.

---

## Task 1: `collectUsedHandles` helper + export `HandleDirection`

**Files:** Modify `topology-graph.tsx`; Test `topology-graph.test.ts`.

- [ ] **Step 1: Failing tests.** In `topology-graph.test.ts`, add `collectUsedHandles` and `type HandleDirection` to the existing `from './topology-graph'` import block (alongside `getBestHandles`). Append this top-level block at the END of the file (after the final line):

```ts
describe('collectUsedHandles', () => {
  it('records sourceHandle on source and targetHandle on target', () => {
    const m = collectUsedHandles([
      { source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    ]);
    expect([...(m.get('a') ?? [])]).toEqual(['right']);
    expect([...(m.get('b') ?? [])]).toEqual(['left']);
  });

  it('keeps both handles for a node used as source and target', () => {
    const m = collectUsedHandles([
      { source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
      { source: 'c', target: 'a', sourceHandle: 'bottom', targetHandle: 'top' },
    ]);
    expect([...(m.get('a') ?? [])].sort()).toEqual(['right', 'top']);
  });

  it('dedupes repeated handles', () => {
    const m = collectUsedHandles([
      { source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
      { source: 'a', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
    ]);
    expect([...(m.get('a') ?? [])]).toEqual(['right']);
  });

  it('ignores null/undefined handles', () => {
    const m = collectUsedHandles([
      { source: 'a', target: 'b', sourceHandle: null, targetHandle: undefined },
    ]);
    expect(m.has('a')).toBe(false);
    expect(m.has('b')).toBe(false);
  });

  it('returns no entry for nodes with no edges', () => {
    const m = collectUsedHandles([]);
    expect(m.size).toBe(0);
  });
});
```

- [ ] **Step 2: Verify fail.** `cd frontend && npx vitest run src/features/containers/components/network/topology-graph.test.ts` → FAIL (import error: `collectUsedHandles` not exported).

- [ ] **Step 3: Implement.** In `topology-graph.tsx`, the line `type HandleDirection = 'top' | 'right' | 'bottom' | 'left';` (in the `// --- Handle helpers` section) → add `export`:

```ts
export type HandleDirection = 'top' | 'right' | 'bottom' | 'left';
```

Then add, right after the `getBestHandles` function (before `// --- End handle helpers ---`):

```ts
/**
 * Map each node id to the set of handle directions some edge attaches to
 * (as source or target). Lets nodes render only their connected handles. Pure.
 */
export function collectUsedHandles(
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
): Map<string, Set<HandleDirection>> {
  const used = new Map<string, Set<HandleDirection>>();
  const add = (nodeId: string, handle?: string | null) => {
    if (!handle) return;
    if (!used.has(nodeId)) used.set(nodeId, new Set());
    used.get(nodeId)!.add(handle as HandleDirection);
  };
  for (const e of edges) {
    add(e.source, e.sourceHandle);
    add(e.target, e.targetHandle);
  }
  return used;
}
```

- [ ] **Step 4: Verify pass + typecheck.** `cd frontend && npx vitest run src/features/containers/components/network/topology-graph.test.ts && npx tsc --noEmit` → PASS, no errors.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/features/containers/components/network/topology-graph.tsx frontend/src/features/containers/components/network/topology-graph.test.ts
git commit -m "feat(topology): add collectUsedHandles helper

Pure helper mapping each node id to the handle directions its edges use.
Export HandleDirection for reuse. No behavior change yet."
```

---

## Task 2: Inject `usedHandles` into node data (Phase 4)

**Files:** Modify `topology-graph.tsx`.

- [ ] **Step 1: Implement.** In the Phase 4 `useMemo` (`const { nodes: initialNodes, edges: initialEdges } = useMemo(...)`), find the final `return { nodes, edges };` (currently line ~612). Immediately BEFORE it, insert:

```ts
    // Render only the handles edges actually attach to (prune orphan dots).
    const usedHandles = collectUsedHandles(edges);
    for (const node of nodes) {
      (node.data as Record<string, unknown>).usedHandles = [...(usedHandles.get(node.id) ?? [])];
    }

```

- [ ] **Step 2: Typecheck + existing tests.** `cd frontend && npx tsc --noEmit && npx vitest run src/features/containers` → clean, all pass (no behavior asserted yet; this just adds data).

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/features/containers/components/network/topology-graph.tsx
git commit -m "feat(topology): inject usedHandles onto node data

Phase 4 tags each node with the handle directions its edges use, so node
components can render only connected handles."
```

---

## Task 3: Filter handles in ContainerNode and NetworkNode

**Files:** Modify `container-node.tsx`, `network-node.tsx`.

- [ ] **Step 1: ContainerNode.** Replace the body of `frontend/src/features/containers/components/network/container-node.tsx` so the four `<Handle>` are conditional. Add after the existing `const related = ...` line:

```ts
  const usedHandles = (data as any).usedHandles as Array<'top' | 'right' | 'bottom' | 'left'> | undefined;
  const showHandle = (id: 'top' | 'right' | 'bottom' | 'left') =>
    usedHandles === undefined || usedHandles.includes(id);
```

Then change each handle line to be guarded (keep `type="source"`, ids, className unchanged):
```tsx
      {showHandle('top') && <Handle id="top" type="source" position={Position.Top} className="!bg-gray-400" />}
      {showHandle('right') && <Handle id="right" type="source" position={Position.Right} className="!bg-gray-400" />}
```
…and likewise the `bottom` and `left` handles further down.

- [ ] **Step 2: NetworkNode.** Same change in `network-node.tsx` — add the identical `usedHandles` / `showHandle` lines after its `const related = ...`, and guard its four handles (keep `type="target"`):
```tsx
      {showHandle('top') && <Handle id="top" type="target" position={Position.Top} className="!bg-gray-400" />}
      {showHandle('right') && <Handle id="right" type="target" position={Position.Right} className="!bg-gray-400" />}
```
…and `bottom` / `left`.

- [ ] **Step 3: Typecheck + full containers suite.** `cd frontend && npx tsc --noEmit && npx vitest run src/features/containers` → clean, all pass.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/features/containers/components/network/container-node.tsx frontend/src/features/containers/components/network/network-node.tsx
git commit -m "feat(topology): render only connected handles on nodes

Container and network nodes now render a handle only when an edge attaches
to it (data.usedHandles), removing orphan connection dots. Falls back to all
four handles when usedHandles is absent."
```

---

## Task 4: Verify

- [ ] **Step 1:** `cd frontend && npx vitest run` → all pass.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && npm run lint -w frontend` → clean.
- [ ] **Step 3: Manual** (run skill / `npm run dev`): open Topology, confirm each node shows dots only where lines meet it, no line snaps to a node center, isolated nodes show no dots, RPC overlay still connects. Screenshot for PR.
- [ ] **Step 4:** Finish via `superpowers:finishing-a-development-branch` → PR to `dev`.

## Self-review notes
- Spec coverage: helper (T1) ✓, inject (T2) ✓, both node components (T3) ✓, fallback-when-undefined (T3) ✓, tests (T1) ✓, verify+manual (T4) ✓.
- Naming consistent: `collectUsedHandles`, `HandleDirection`, `usedHandles`, `showHandle` used identically across tasks.
- Node-component DOM tests intentionally omitted (bare `<Handle>` needs ReactFlowProvider) — per spec; coverage via pure helper + manual check.
