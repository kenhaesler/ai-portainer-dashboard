# Network Topology — Zoomed-Out Static Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Network Topology readable at ~200 containers by packing stacks into a compact deterministic grid, giving containers more breathing room, locking the canvas (pan/zoom only), and tuning zoom so the whole fleet fits.

**Architecture:** The top-level ELK layout switches from organic `stress` to `rectpacking` (ELK's algorithm for packing unconnected boxes) with `SEPARATE_CHILDREN` so each stack still lays out its interior independently. The `d3-force` drag simulation is deleted entirely (the canvas becomes static), and React Flow viewport props are tuned (`minZoom`, `fitViewOptions`, `onlyRenderVisibleElements`).

**Tech Stack:** React 19, `@xyflow/react` 12.10.2, `elkjs` 0.11.1, Vitest + jsdom + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-30-topology-overview-scale-design.md`

---

## Working directory & conventions

All paths are relative to the repo root. The active worktree is
`/home/simon/Documents/ai-portainer-dashboard/.claude/worktrees/feature+topology-overview-scale`
on branch `feature/topology-overview-scale`.

- **Run frontend tests from the `frontend/` directory**, not the worktree root
  (the root has no jsdom config). Example:
  `cd frontend && npx vitest run src/features/containers/...`
- If vitest fails to spawn workers in the sandbox, add `--pool=threads`.
- **Never use `git add -A` / `-u`** in this worktree — `node_modules` are
  symlinks that can be accidentally staged. Always `git add <explicit paths>`.
- **Never use `--no-verify`** (project rule). The husky pre-commit hook runs
  `npm ci --dry-run` (lockfile sanity) and prints an `add <pkg>` dump — that is a
  dry run and changes nothing; do not be alarmed.
- `npm install` is run **from the repo root only** (npm workspaces).

## File Structure

Files created or modified, with responsibility:

- **`frontend/src/features/containers/hooks/use-elk-layout.ts`** (modify) — the
  elkjs layout hook. Gains an optional `rootLayoutOptions` input and a pure,
  exported `buildRootGraph` helper; the hardcoded `ROOT_LAYOUT_OPTIONS` becomes
  the exported default `DEFAULT_ROOT_LAYOUT_OPTIONS`.
- **`frontend/src/features/containers/hooks/use-elk-layout.test.ts`** (modify) —
  add tests for `buildRootGraph` and a real-elkjs `rectpacking` root run.
- **`frontend/src/features/containers/components/network/topology-graph.tsx`**
  (modify) — owns the app's layout config (`ROOT_LAYOUT_OPTIONS` =
  rectpacking, roomier `GROUP_LAYOUT_OPTIONS`), drops root-level ELK edges,
  removes all force-simulation wiring, sets the canvas static, and tunes the
  viewport.
- **`frontend/src/features/containers/components/network/topology-graph.test.ts`**
  (modify) — add config-guard tests (root algorithm, interior spacing, viewport).
- **`frontend/src/features/containers/hooks/use-force-simulation.ts`** (delete).
- **`frontend/src/features/containers/hooks/use-force-simulation.test.ts`** (delete).
- **`frontend/package.json`** (modify) — remove `d3-force` and `@types/d3-force`.
- **`docs/architecture.md`** and **`CLAUDE.md`** (modify) — document the change.

---

## Task 1: Parameterize the ELK root layout options

Make `useElkLayout` accept an optional `rootLayoutOptions` and extract a pure,
testable `buildRootGraph` helper. This lets `topology-graph.tsx` own all layout
config in one place (Task 2) while keeping the hook generic.

**Files:**
- Modify: `frontend/src/features/containers/hooks/use-elk-layout.ts`
- Test: `frontend/src/features/containers/hooks/use-elk-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/containers/hooks/use-elk-layout.test.ts`. Also
update the import on line 3 to pull in the new exports:

```ts
import {
  useElkLayout,
  buildCacheKey,
  buildRootGraph,
  DEFAULT_ROOT_LAYOUT_OPTIONS,
  type ElkLayoutNode,
  type ElkLayoutEdge,
} from './use-elk-layout';
```

Add these `describe` blocks at the end of the file:

```ts
describe('buildRootGraph', () => {
  it('defaults to DEFAULT_ROOT_LAYOUT_OPTIONS when none provided', () => {
    const graph = buildRootGraph([{ id: 'a', width: 10, height: 10 }], []);
    expect(graph.id).toBe('root');
    expect(graph.layoutOptions).toBe(DEFAULT_ROOT_LAYOUT_OPTIONS);
  });

  it('applies provided rootLayoutOptions to the root node', () => {
    const opts = { 'elk.algorithm': 'rectpacking' };
    const graph = buildRootGraph([{ id: 'a', width: 10, height: 10 }], [], opts);
    expect(graph.layoutOptions).toBe(opts);
  });

  it('converts children and edges into elk format', () => {
    const graph = buildRootGraph(
      [
        { id: 'a', width: 10, height: 10 },
        { id: 'b', width: 10, height: 10 },
      ],
      [{ id: 'e1', source: 'a', target: 'b' }],
    );
    expect(graph.children).toHaveLength(2);
    expect(graph.edges).toEqual([{ id: 'e1', sources: ['a'], targets: ['b'] }]);
  });
});

describe('useElkLayout with a rectpacking root', () => {
  it('lays out multiple disconnected stacks without choking', async () => {
    const nodes: ElkLayoutNode[] = [
      { id: 'g1', width: 0, height: 0, children: [{ id: 'c1', width: 100, height: 50 }] },
      { id: 'g2', width: 0, height: 0, children: [{ id: 'c2', width: 100, height: 50 }] },
      { id: 'n1', width: 100, height: 50 },
    ];
    const rootLayoutOptions = {
      'elk.algorithm': 'rectpacking',
      'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
    };
    const { result } = renderHook(() =>
      useElkLayout({ nodes, edges: [], rootLayoutOptions }),
    );
    await waitFor(() => {
      expect(result.current.get('g1')).toBeDefined();
      expect(result.current.get('g2')).toBeDefined();
    });
    expect(result.current.get('c1')).toBeDefined();
    expect(result.current.get('n1')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/hooks/use-elk-layout.test.ts`
Expected: FAIL — `buildRootGraph` / `DEFAULT_ROOT_LAYOUT_OPTIONS` are not exported
(import error), and the rectpacking test errors because `useElkLayout` does not
yet accept `rootLayoutOptions`.

- [ ] **Step 3: Implement the change**

In `frontend/src/features/containers/hooks/use-elk-layout.ts`:

(a) Add `rootLayoutOptions` to the input interface:

```ts
export interface ElkLayoutInput {
  nodes: ElkLayoutNode[];
  edges: ElkLayoutEdge[];
  rootLayoutOptions?: Record<string, string>;
}
```

(b) Rename the existing `ROOT_LAYOUT_OPTIONS` constant to
`DEFAULT_ROOT_LAYOUT_OPTIONS` and export it (keep the same values):

```ts
export const DEFAULT_ROOT_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '200',
  'elk.spacing.nodeNode': '80',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
};
```

(c) Add the pure `buildRootGraph` helper (place it right after `buildElkNode`):

```ts
/** Build the synthetic ELK root graph (pure; exported for testing). */
export function buildRootGraph(
  nodes: ElkLayoutNode[],
  edges: ElkLayoutEdge[],
  rootLayoutOptions: Record<string, string> = DEFAULT_ROOT_LAYOUT_OPTIONS,
): ElkNode {
  const children = nodes.map(buildElkNode);
  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));
  return { id: 'root', layoutOptions: rootLayoutOptions, children, edges: elkEdges };
}
```

(d) Use it inside the hook. Replace the body of the `useEffect` that builds
`elkNodes` / `elkEdges` / `graph` so it calls `buildRootGraph`, and add
`rootLayoutOptions` to the input destructure and the effect deps:

```ts
export function useElkLayout({ nodes, edges, rootLayoutOptions }: ElkLayoutInput) {
  const [positions, setPositions] = useState<Map<string, LayoutPosition>>(
    () => new Map(),
  );
  const cacheKeyRef = useRef('');

  const cacheKey = buildCacheKey(nodes, edges);

  useEffect(() => {
    if (cacheKey === cacheKeyRef.current) return;
    cacheKeyRef.current = cacheKey;

    if (nodes.length === 0) {
      setPositions(new Map());
      return;
    }

    const graph = buildRootGraph(nodes, edges, rootLayoutOptions);

    elk.layout(graph).then((result) => {
      const map = new Map<string, LayoutPosition>();
      extractPositions(result.children, map);
      setPositions(map);
    });
  }, [cacheKey, nodes, edges, rootLayoutOptions]);

  return positions;
}
```

Note: `rootLayoutOptions` is passed as a stable module-level constant by the
caller, so adding it to the deps array does not cause extra layout runs (the
`cacheKey` early-return still gates redundant work).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/hooks/use-elk-layout.test.ts`
Expected: PASS (all `buildCacheKey`, `useElkLayout`, `buildRootGraph`, and
rectpacking cases green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/containers/hooks/use-elk-layout.ts frontend/src/features/containers/hooks/use-elk-layout.test.ts
git commit -m "feat(topology): parameterize ELK root layout options

Extract a pure buildRootGraph helper and let useElkLayout accept an
optional rootLayoutOptions, defaulting to the previous stress config.
Prepares the hook for a rectpacking root without changing current behavior."
```

---

## Task 2: Switch the root to rectpacking and roomier stack interiors

Make `topology-graph.tsx` own the app layout config: a `rectpacking` root grid,
more spacing between container nodes, and stop feeding root-level cross-stack
edges into ELK (rectpacking packs boxes, ignores edges; React Flow still draws
every edge in Phase 4).

**Files:**
- Modify: `frontend/src/features/containers/components/network/topology-graph.tsx`
- Test: `frontend/src/features/containers/components/network/topology-graph.test.ts`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/containers/components/network/topology-graph.test.ts`,
extend the import on line 2 and add a `describe` block:

```ts
import {
  getEdgeStyle,
  sortContainers,
  sortStacks,
  getBestHandles,
  formatRate,
  getHandleForAngle,
  ROOT_LAYOUT_OPTIONS,
  GROUP_LAYOUT_OPTIONS,
} from './topology-graph';

describe('layout configuration', () => {
  it('packs stacks at the root with rectpacking + separate children', () => {
    expect(ROOT_LAYOUT_OPTIONS['elk.algorithm']).toBe('rectpacking');
    expect(ROOT_LAYOUT_OPTIONS['elk.hierarchyHandling']).toBe('SEPARATE_CHILDREN');
  });

  it('gives container nodes generous spacing inside each stack', () => {
    expect(GROUP_LAYOUT_OPTIONS['elk.algorithm']).toBe('stress');
    expect(Number(GROUP_LAYOUT_OPTIONS['elk.spacing.nodeNode'])).toBeGreaterThanOrEqual(160);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/components/network/topology-graph.test.ts`
Expected: FAIL — `ROOT_LAYOUT_OPTIONS` and `GROUP_LAYOUT_OPTIONS` are not
exported (import error).

- [ ] **Step 3: Update the layout constants**

In `topology-graph.tsx`, replace the existing `GROUP_LAYOUT_OPTIONS` constant
(currently non-exported, `nodeNode: '100'`) with the following exported
constants. Place `ROOT_LAYOUT_OPTIONS` and `EMPTY_ELK_EDGES` right after it:

```ts
// Layout options for within-group arrangement (each stack lays out its interior
// with stress; bumped spacing gives container nodes room to breathe at scale).
export const GROUP_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '220',
  'elk.spacing.nodeNode': '160',
  'elk.padding': '[top=50, left=40, bottom=40, right=40]',
};

// Root packs the (mostly-disconnected) stack boxes into a compact, deterministic
// grid. rectpacking is ELK's algorithm for packing unconnected boxes;
// SEPARATE_CHILDREN lets each stack run its own interior layout independently.
export const ROOT_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'rectpacking',
  'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
  'elk.aspectRatio': '1.6',
  'elk.rectpacking.widthApproximation.optimizationGoal': 'ASPECT_RATIO_DRIVEN',
  'elk.expandNodes': 'true',
  'elk.spacing.nodeNode': '60',
  'elk.padding': '[top=24, left=24, bottom=24, right=24]',
};

// rectpacking ignores edges; React Flow still draws container↔network edges in
// Phase 4, so we hand ELK an empty root edge set (stable reference).
const EMPTY_ELK_EDGES: ElkLayoutEdge[] = [];
```

- [ ] **Step 4: Stop feeding root-level edges to ELK (Phase 2)**

In the Phase 2 `useMemo` (`Build compound elkjs graph`), remove the root
`elkEdges` array and the external-net edge push, keeping the intra-stack
`groupEdges`. The memo now returns only `elkNodes`. Replace the whole Phase 2
block with:

```ts
  // Phase 2: Build compound elkjs graph — groups with children + intra-stack edges
  const { elkNodes } = useMemo(() => {
    const elkNodes: ElkLayoutNode[] = [];

    for (const bp of blueprints) {
      const children: ElkLayoutNode[] = [];
      const groupEdges: ElkLayoutEdge[] = [];

      // Inline networks as group children
      for (const net of bp.inlineNets) {
        children.push({ id: `net-${net.id}`, width: NETWORK_W, height: NETWORK_H });
      }

      // Containers as group children
      for (const container of bp.containers) {
        children.push({ id: `container-${container.id}`, width: CONTAINER_W, height: CONTAINER_H });

        for (const netName of container.networks) {
          // Intra-group edge (container → inline net within same stack)
          const inlineNet = bp.inlineNets.find((n) => n.name === netName);
          if (inlineNet) {
            groupEdges.push({
              id: `e-${container.id}-${inlineNet.id}`,
              source: `container-${container.id}`,
              target: `net-${inlineNet.id}`,
            });
          }
          // Cross-stack edges are intentionally NOT fed to ELK: the root uses
          // rectpacking (edgeless box packing). React Flow draws them in Phase 4.
        }
      }

      elkNodes.push({
        id: bp.groupId,
        width: 0,
        height: 0,
        children,
        edges: groupEdges.length > 0 ? groupEdges : undefined,
        layoutOptions: GROUP_LAYOUT_OPTIONS,
      });
    }

    // External networks at root level (packed as boxes alongside the stacks)
    for (const net of externalNets) {
      elkNodes.push({ id: `net-${net.id}`, width: NETWORK_W, height: NETWORK_H });
    }

    return { elkNodes };
  }, [blueprints, externalNets]);
```

- [ ] **Step 5: Pass the new root options to the layout hook (Phase 3)**

Replace the Phase 3 call:

```ts
  // Phase 3: Run elkjs compound layout (rectpacking root + per-stack interiors)
  const layoutPositions = useElkLayout({
    nodes: elkNodes,
    edges: EMPTY_ELK_EDGES,
    rootLayoutOptions: ROOT_LAYOUT_OPTIONS,
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/components/network/topology-graph.test.ts`
Expected: PASS (config-guard tests green, existing pure-helper tests still green).

- [ ] **Step 7: Typecheck (catches the removed `elkEdges` reference)**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (If it flags an unused `ElkLayoutEdge` import, it is still
used by `EMPTY_ELK_EDGES` and `groupEdges` — re-check you kept those.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/containers/components/network/topology-graph.tsx frontend/src/features/containers/components/network/topology-graph.test.ts
git commit -m "feat(topology): rectpacking grid of stacks with roomier interiors

Root layout switches from organic stress to rectpacking + SEPARATE_CHILDREN
for a compact, deterministic, scannable grid of stack boxes. Container-node
spacing inside each stack increases (nodeNode 100->160). Root-level cross-stack
edges are no longer fed to ELK (rectpacking is edgeless); React Flow still
renders every edge."
```

---

## Task 3: Make the canvas static and delete the force simulation

With dragging gone, remove the entire `d3-force` apparatus and lock the canvas.

**Files:**
- Modify: `frontend/src/features/containers/components/network/topology-graph.tsx`
- Delete: `frontend/src/features/containers/hooks/use-force-simulation.ts`
- Delete: `frontend/src/features/containers/hooks/use-force-simulation.test.ts`

- [ ] **Step 1: Delete the force-simulation hook and its test**

```bash
git rm frontend/src/features/containers/hooks/use-force-simulation.ts frontend/src/features/containers/hooks/use-force-simulation.test.ts
```

- [ ] **Step 2: Remove the import in `topology-graph.tsx`**

Delete line 18:

```ts
import { useForceSimulation } from '../../hooks/use-force-simulation';
```

- [ ] **Step 3: Remove all force-simulation wiring in `topology-graph.tsx`**

Delete these blocks (they appear after the `useEdgesState` / `setEdges` effects
and before `handleNodeClick`):

- the `simNodes` `useMemo`,
- the `simLinks` `useMemo`,
- the `childToGroupRef` `useRef` + its `useEffect`,
- the `handleSimTick` `useCallback`,
- the `useForceSimulation({ ... })` call,
- the `handleDragStart`, `handleDrag`, and `handleDragStop` `useCallback`s.

After this, the only callback left before the early-return is `handleNodeClick`:

```ts
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (onNodeClick) {
      onNodeClick(node.id);
    }
  }, [onNodeClick]);
```

- [ ] **Step 4: Drop the drag props and lock dragging in the JSX**

In the `<ReactFlow>` element, remove the three drag handlers and set
`nodesDraggable={false}`. The element should now read (viewport props come in
Task 4):

```tsx
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
```

- [ ] **Step 5: Clean up now-unused React imports**

`useRef` was only used by `childToGroupRef`; remove it from the React import on
line 1. Keep `useMemo`, `useCallback` (used by `handleNodeClick`), and
`useEffect` (used by the `setNodes`/`setEdges` effects):

```ts
import { useMemo, useCallback, useEffect } from 'react';
```

- [ ] **Step 6: Verify no references remain**

Run:

```bash
cd frontend && grep -rn "useForceSimulation\|use-force-simulation\|handleDragStart\|handleSimTick\|childToGroupRef\|simNodes\|simLinks" src
```

Expected: no matches.

- [ ] **Step 7: Typecheck and run the topology tests**

Run:

```bash
cd frontend && npx tsc --noEmit && npx vitest run src/features/containers
```

Expected: typecheck clean; all `src/features/containers` tests pass (the deleted
force-sim test is gone; nothing else referenced it).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/containers/components/network/topology-graph.tsx
git commit -m "feat(topology): lock the canvas and remove the force simulation

The topology is now fully static (pan/zoom/click only) — nodesDraggable is
false and the d3-force drag simulation, its hook, and all wiring are deleted.
Layout is 100% deterministic from ELK, so there are no messy hand-moved
positions."
```

---

## Task 4: Tune the viewport for a zoomed-out overview

Lower `minZoom` so the whole fleet fits, prevent over-zoom on a sparse fit, and
cull off-screen elements for performance.

**Files:**
- Modify: `frontend/src/features/containers/components/network/topology-graph.tsx`
- Test: `frontend/src/features/containers/components/network/topology-graph.test.ts`

- [ ] **Step 1: Write the failing tests**

In `topology-graph.test.ts`, add the new exports to the import and a `describe`:

```ts
import {
  // ...existing imports...
  FIT_VIEW_OPTIONS,
  MIN_ZOOM,
  MAX_ZOOM,
} from './topology-graph';

describe('viewport configuration', () => {
  it('zooms out far enough to fit a large fleet', () => {
    expect(MIN_ZOOM).toBeLessThanOrEqual(0.1);
    expect(MAX_ZOOM).toBeGreaterThanOrEqual(1);
  });

  it('does not over-zoom a sparse fit', () => {
    expect(FIT_VIEW_OPTIONS.maxZoom).toBeLessThanOrEqual(1);
    expect(FIT_VIEW_OPTIONS.padding).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/components/network/topology-graph.test.ts`
Expected: FAIL — `FIT_VIEW_OPTIONS` / `MIN_ZOOM` / `MAX_ZOOM` not exported.

- [ ] **Step 3: Add the viewport constants**

In `topology-graph.tsx`, add these exported constants next to the layout
constants from Task 2:

```ts
// Viewport tuning for a large fleet: minZoom well below React Flow's 0.5 default
// so ~200 nodes fit, and a fitView that doesn't over-zoom a sparse grid.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const FIT_VIEW_OPTIONS = { padding: 0.1, maxZoom: 1 } as const;
```

- [ ] **Step 4: Apply them in the JSX**

Update the `<ReactFlow>` element to its final form:

```tsx
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        onlyRenderVisibleElements
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/components/network/topology-graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/containers/components/network/topology-graph.tsx frontend/src/features/containers/components/network/topology-graph.test.ts
git commit -m "feat(topology): tune viewport for a zoomed-out overview

minZoom 0.1 (below React Flow's 0.5 default) so the whole fleet fits,
fitViewOptions caps the initial fit at 1x with padding, and
onlyRenderVisibleElements culls off-screen nodes/edges at ~200 nodes."
```

---

## Task 5: Remove the `d3-force` dependency

Nothing imports `d3-force` anymore (verified in Task 3). Remove it from the
frontend manifest.

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (regenerated; gitignored — see note)

- [ ] **Step 1: Confirm nothing imports d3-force**

Run: `grep -rn "d3-force" frontend/src`
Expected: no matches.

- [ ] **Step 2: Remove the two manifest entries**

In `frontend/package.json`, delete the `dependencies` line:

```json
    "d3-force": "^3.0.0",
```

and the `devDependencies` line:

```json
    "@types/d3-force": "^3.0.10",
```

- [ ] **Step 3: Reinstall from the repo root to update the lockfile**

Run: `npm install` (from the repo root — npm workspaces).
Expected: completes; `d3-force` removed from the dependency tree.

- [ ] **Step 4: Verify the frontend still builds and tests pass**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/features/containers`
Expected: typecheck clean, tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json
git commit -m "chore(topology): drop unused d3-force dependency

The force simulation was removed with the static-canvas change; d3-force
and its types are no longer imported anywhere."
```

Note: `frontend/package-lock.json` is gitignored in this repo (see `.gitignore`),
so it is not committed here; the root lockfile is what CI uses. If
`git status` shows a tracked lockfile change, add it to this commit.

---

## Task 6: Update documentation

Project rule (`CLAUDE.md`): doc updates ship with the change.

**Files:**
- Modify: `docs/architecture.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate the topology mention in architecture.md**

Run: `grep -n -i "topology\|react-flow\|reactflow\|d3-force\|elk" docs/architecture.md`
This shows where (if anywhere) the topology view is described.

- [ ] **Step 2: Update architecture.md**

If a topology section exists, update it; otherwise add this paragraph under the
frontend/visualization section:

```markdown
### Network Topology

The Network Topology view (`frontend/src/features/containers/components/network/`)
renders containers grouped into Docker Compose stacks using `@xyflow/react`.
Layout is computed by `elkjs`: the root packs the (mostly disconnected) stack
boxes into a compact, deterministic grid with `rectpacking` + `SEPARATE_CHILDREN`,
while each stack lays out its interior with `stress`. The canvas is static
(pan / zoom / click-to-select only) — there is no node dragging and no force
simulation. The viewport uses a low `minZoom` so the full fleet (~200 containers)
fits in a single zoomed-out overview.
```

- [ ] **Step 3: Update CLAUDE.md if it references the old behavior**

Run: `grep -n -i "topology\|d3-force\|force simulation" CLAUDE.md`
If anything describes draggable stacks / a force layout, update it to match the
static rectpacking design. If there is no such reference, no change is needed.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md CLAUDE.md
git commit -m "docs(topology): document static rectpacking overview"
```

(If only `docs/architecture.md` changed, commit just that file.)

---

## Task 7: Full verification

- [ ] **Step 1: Full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (baseline before this work was 1997+ green; this change
removes the force-sim test file and adds config/layout tests).
If worker-spawn errors appear in the sandbox, re-run with `--pool=threads`.

- [ ] **Step 2: Typecheck and lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint -w frontend`
Expected: no errors.

- [ ] **Step 3: Manual verification in the running app**

Use the `run` skill (or `npm run dev` from the repo root) to launch the app and
open the Network Topology page. Confirm:
- stacks are arranged in a compact grid (not a scattered cloud),
- the whole fleet fits when zoomed to fit (no clipping),
- container nodes inside a stack have clear spacing,
- nothing is draggable (stacks and containers stay put on drag attempts),
- pan, zoom, MiniMap, click-to-select, and the RPC/observed-traffic overlay
  still work, and edges still render.

Capture a screenshot for the PR. If a seeded ~200-container dataset isn't
available locally, note that in the PR and rely on the layout/config tests plus
a smaller-dataset screenshot.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to open the PR
(`feature/topology-overview-scale` → `dev`), linking the spec and a screenshot.

---

## Self-review notes (for the executor)

- **Spec coverage:** root rectpacking (Task 2) ✓; SEPARATE_CHILDREN + per-stack
  stress interior with more spacing (Tasks 1–2) ✓; drop root ELK edges (Task 2) ✓;
  fully static + delete force sim + hook + test (Task 3) ✓; remove d3-force dep
  (Task 5) ✓; minZoom / fitViewOptions / onlyRenderVisibleElements (Task 4) ✓;
  tests updated/added, force-sim test removed (Tasks 1, 2, 4) ✓; docs (Task 6) ✓.
  Non-goals (collapse, semantic zoom, edge hiding, filter-to-focus) are correctly
  absent.
- **Naming consistency:** the hook's default is `DEFAULT_ROOT_LAYOUT_OPTIONS`
  (in `use-elk-layout.ts`); the app's rectpacking config is `ROOT_LAYOUT_OPTIONS`
  (in `topology-graph.tsx`). These are intentionally different constants in
  different modules. `buildRootGraph`, `GROUP_LAYOUT_OPTIONS`, `FIT_VIEW_OPTIONS`,
  `MIN_ZOOM`, `MAX_ZOOM` are used identically wherever referenced.
- **Tunable values:** `GROUP_LAYOUT_OPTIONS['elk.spacing.nodeNode']=160` and
  `ROOT_LAYOUT_OPTIONS['elk.spacing.nodeNode']=60` / `aspectRatio=1.6` are
  starting estimates; adjust during manual verification without changing the
  task structure (the guard tests assert `>=160` and the algorithm, not exact
  spacing).
