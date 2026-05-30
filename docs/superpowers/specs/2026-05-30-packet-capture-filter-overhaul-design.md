# Packet Capture filter overhaul — design

**Date:** 2026-05-30
**Branch:** `worktree-feature+packet-capture-filter-overhaul`
**Status:** Approved (design); pending implementation plan

## Problem

The New Capture form on the Packet Capture page (`frontend/src/features/security/pages/packet-capture.tsx`) forces a rigid cascade:

1. Select an **Endpoint** (required).
2. Only then do the **Stack** and **Container** dropdowns unlock (they are `disabled` until an endpoint is chosen).

Consequences:

- You cannot simply **type a container name** to start a capture.
- You cannot **find a stack or container across endpoints** without first knowing — and selecting — its endpoint. In a multi-endpoint fleet you must already know where a workload lives.

This overhaul makes the target picker **search-first and cross-endpoint**, while keeping the dropdowns as an optional browse fallback. It also adds search to the capture history table and quick presets to the BPF filter input.

## Goals

- Type a container name (or stack/endpoint name) directly to find a capture target — no endpoint pre-selection.
- Search **stacks and containers across all endpoints** at once; results show which endpoint/stack they belong to.
- Keep the existing Endpoint → Stack → Container dropdowns available as a collapsible fallback.
- Add free-text search to the capture **History** table (server-side, across all captures).
- Add quick **BPF presets** alongside the free-text BPF input.
- Improve internal structure: extract focused, independently testable components from the 667-line page.

## Non-goals (YAGNI)

- AI / natural-language search mode (the `WorkloadSmartSearch` AI path). Not needed for target selection.
- URL-synced filter state / shareable deep links.
- Saved filters.
- Server-side **async** container search. Client-side cross-endpoint filtering is fine at typical Portainer fleet scale (tens–hundreds of containers). The picker interface is designed so this can be swapped later without changing call sites.
- Changing capture semantics: a capture still targets exactly **one container** on one endpoint. "Searching stacks" narrows the container list; a stack is not itself a capture target.

## Current state (verified)

- `useContainers({ state: 'running' })` with **no** `endpointId` already returns running containers across **all** endpoints via `GET /api/containers?state=running`. Each `Container` carries `endpointId` and `endpointName` (`frontend/src/features/containers/hooks/use-containers.ts`).
- `useStacks()` returns all stacks across all endpoints; `Stack` has `endpointId`, `name` (`.../hooks/use-stacks.ts`).
- `useEndpoints()` returns each endpoint's `edgeMode: 'standard' | 'async' | null` and `capabilities` (`.../hooks/use-endpoints.ts`). Edge-async endpoints cannot run docker exec → cannot capture.
- `filterContainers(containers, query, knownStackNames)` already parses free text plus `name:` / `image:` / `state:` / `status:` / `stack:` / `endpoint:` / `port:` / `label:` tokens (AND semantics) (`frontend/src/features/containers/lib/workload-search-filter.ts`). Reused as-is.
- `cmdk` is already a dependency (used by `frontend/src/features/core/components/layout/command-palette.tsx`).
- Stack grouping helpers exist: `buildStackGroupedContainerOptions`, `resolveContainerStackName`, `NO_STACK_LABEL` (`frontend/src/features/containers/lib/container-stack-grouping.ts`).
- `POST /api/pcap/captures` requires `{ endpointId, containerId, containerName, filter?, durationSeconds?, maxPackets? }`. Once a container is selected we know its `endpointId`, so no extra lookup is needed.
- `GET /api/pcap/captures` (admin-gated, `PCAP_ENABLED`-gated) accepts `status` / `containerId` / `limit` / `offset` only — **no text search** (`packages/security/src/routes/pcap.ts`, `CaptureListQuerySchema` in `packages/security/src/models/pcap.ts`).
- The history table does not currently display which endpoint a capture ran on.

## Architecture

The page becomes an orchestrator that composes three focused components. New components live in `frontend/src/features/security/components/` (dir already exists).

### 1. `CaptureTargetPicker` — search-first, cross-endpoint target selector

File: `frontend/src/features/security/components/capture-target-picker.tsx`

**Responsibility:** Given the full cross-endpoint running-container list, let the user find and select exactly one container as the capture target, then display it as a removable chip with endpoint/stack context.

**Props (interface):**

```ts
export interface CaptureTarget {
  endpointId: number;
  containerId: string;
  containerName: string;
  endpointName: string;
  stackName: string; // resolved stack or NO_STACK_LABEL, for the chip
}

export interface CaptureTargetPickerProps {
  containers: Container[];      // all running containers, cross-endpoint
  stacks: Stack[];             // all stacks, cross-endpoint
  edgeAsyncEndpointIds: Set<number>; // endpoints that cannot capture
  value: CaptureTarget | null;
  onChange: (target: CaptureTarget | null) => void;
  autoFocus?: boolean;
}
```

**Behavior:**

- Renders a `cmdk` combobox: a `Command.Input` plus an inline `Command.List` shown when the input is focused and non-empty.
- `shouldFilter={false}` — filtering is done by the existing `filterContainers(containers, query, knownStackNames)`, so `name:` / `stack:` / `endpoint:` / `image:` / `port:` tokens and bare free text all work. `knownStackNames` derives from `stacks`.
- Results are **grouped by endpoint** (`Command.Group` heading = `endpointName`). Each `Command.Item`:
  - `value={container.id}`, `onSelect` → builds a `CaptureTarget` (resolving stack via `resolveContainerStackName`) and calls `onChange`.
  - Renders container name, muted image, and a stack chip.
  - If `edgeAsyncEndpointIds.has(container.endpointId)`: rendered **disabled** with a tooltip ("Capture unavailable — Edge Async endpoint (no docker exec)").
- **Stack quick-filters:** at the top of the list, stack names matching the current query render as selectable rows ("Stack: web-stack") that set the query to `stack:<name>`. This is how a user "searches stacks" and drills into a stack's containers without choosing an endpoint.
- **Selected state:** when `value` is set, render a removable token/chip — `containerName · endpointName · stackName` — with an X that calls `onChange(null)`. The search input is hidden while a target is selected (clicking X returns to search).
- Empty state: if the query yields no matches, show "No running containers match." If there are zero running containers at all, show a hint to check endpoints.
- Keyboard a11y comes from cmdk (arrow nav, Enter to select); the input has an `aria-label`.

### 2. `BpfFilterInput` — free-text BPF + presets

File: `frontend/src/features/security/components/bpf-filter-input.tsx`

**Props:** `{ value: string; onChange: (v: string) => void }`

**Behavior:**

- The existing free-text input (placeholder "e.g. port 80 or tcp"), unchanged validation contract (server-side regex `BPF_FILTER_REGEX` stays authoritative).
- A row of preset chips: `tcp`, `udp`, `icmp`, `port 80`, `port 443`, `port 53`, `not port 22`. Clicking a chip appends the token to the current value (space-separated), or sets it if empty. Presets are a starting point the user can edit freely.

### 3. Capture History search + Endpoint column

- A debounced search box rendered beside the existing status tabs (status tabs unchanged). The search term is passed to `useCaptures({ status, search })`.
- `useCaptures` (`frontend/src/features/security/hooks/use-pcap.ts`) gains an optional `search` param, forwarded as `?search=` and folded into the query key.
- The history `DataTable` gains an **Endpoint** column that maps `capture.endpoint_id` → endpoint name via `useEndpoints()` (falls back to `#<id>` when unknown). This matters now that captures span endpoints.

### 4. `packet-capture.tsx` orchestration

- Loads `useContainers({ state: 'running' })` (cross-endpoint, no `endpointId`), `useStacks()`, `useEndpoints()`.
- Computes `edgeAsyncEndpointIds = new Set(endpoints.filter(e => e.edgeMode === 'async').map(e => e.id))`.
- Holds `target: CaptureTarget | null` state (replaces the four separate `selectedEndpoint/Stack/Container/ContainerName` states for the primary path).
- Edge-async warning is shown contextually for the **selected target's** endpoint (not a global per-dropdown warning).
- Start Capture enabled when: `target != null` && target endpoint not edge-async && capture not pending. Calls `startCapture.mutate({ endpointId: target.endpointId, containerId: target.containerId, containerName: target.containerName, filter, durationSeconds, maxPackets })`.
- **Browse fallback:** the existing Endpoint → Stack → Container dropdowns move into a collapsible "Browse by endpoint" `<details>`/disclosure (default collapsed). Selecting through it produces the same `CaptureTarget` and updates the chip. This reuses the existing grouping helpers and keeps discoverability for users who prefer drilling down.

## Data flow

```
page mount
  ├─ useContainers({ state: 'running' })  → all running containers (cross-endpoint)
  ├─ useStacks()                          → all stacks (knownStackNames)
  ├─ useEndpoints()                       → edgeAsyncEndpointIds, endpoint-name map
  └─ useCaptures({ status, search })      → history rows

CaptureTargetPicker(query)
  → filterContainers(containers, query, knownStackNames)
  → grouped by endpoint, edge-async disabled
  → onSelect → target {endpointId, containerId, containerName, endpointName, stackName}

Start Capture → startCapture.mutate({ ...target, filter, durationSeconds, maxPackets })
```

## Backend changes (minimal)

- `packages/security/src/models/pcap.ts`: add `search: z.string().max(200).optional()` to `CaptureListQuerySchema`.
- `packages/security/src/services/pcap-service.ts` (`listCaptures`): pass `search` through to the store.
- pcap-store `getCaptures(options)`: when `search` is present, add a **parameterized** SQL predicate — `AND (container_name ILIKE $n OR COALESCE(filter,'') ILIKE $n)` with `%search%`. No string concatenation. Existing `status` / `containerId` / `limit` / `offset` behavior unchanged.
- Route, admin gate (`requireRole('admin')`), and `PCAP_ENABLED` gate unchanged.

## Edge cases

- **Edge-async endpoints:** containers shown but disabled in the picker; Start disabled with a contextual warning if somehow selected via fallback.
- **Stopped containers:** only `state: 'running'` are fetched (tcpdump needs a live container), matching today's behavior.
- **No endpoints / zero running containers:** picker shows a helpful empty state.
- **Container disappears between load and capture start:** the start mutation already errors server-side; surface the existing error toast.
- **Duplicate container names across endpoints:** disambiguated by the endpoint group heading and the selection chip context.
- **History search with pagination:** search is server-side, so it filters across all captures, not just the loaded 50.

## Testing plan (mandatory — every change needs tests)

**Frontend (Vitest + jsdom + Testing Library):**

- `capture-target-picker.test.tsx`:
  - typing `nginx` surfaces matching containers from multiple endpoints (grouped);
  - `stack:web` narrows to that stack's containers across endpoints;
  - an edge-async endpoint's container is rendered disabled;
  - selecting a container emits the correct `CaptureTarget` and renders the chip with endpoint + stack;
  - clearing the chip resets to search;
  - no endpoint pre-selection is required to see results.
- `bpf-filter-input.test.tsx`: clicking a preset appends the token; free-text editing preserved.
- `packet-capture.test.tsx` (update): page works with no endpoint selected; Start disabled until a target is chosen; edge-async target disables Start with warning; history search box drives `useCaptures` `search`; Endpoint column renders.

**Backend (Vitest + real PostgreSQL):**

- `packages/security/src/__tests__/pcap-route.test.ts`: `GET /api/pcap/captures?search=foo` returns only captures whose `container_name`/`filter` match; still admin-gated.
- `packages/security/src/__tests__/pcap-model.test.ts`: `CaptureListQuerySchema` accepts `search`, rejects over-long input.
- pcap-store/service test: `getCaptures`/`listCaptures` apply the parameterized search filter.

## File-by-file change list

**New (frontend):**
- `frontend/src/features/security/components/capture-target-picker.tsx`
- `frontend/src/features/security/components/capture-target-picker.test.tsx`
- `frontend/src/features/security/components/bpf-filter-input.tsx`
- `frontend/src/features/security/components/bpf-filter-input.test.tsx`

**Edit (frontend):**
- `frontend/src/features/security/pages/packet-capture.tsx` (orchestrate; remove forced cascade; collapsible browse fallback; endpoint column; history search box)
- `frontend/src/features/security/pages/packet-capture.test.tsx` (update)
- `frontend/src/features/security/hooks/use-pcap.ts` (`useCaptures` gains `search`)

**Reuse (frontend, no change):**
- `frontend/src/features/containers/lib/workload-search-filter.ts` (`filterContainers`)
- `frontend/src/features/containers/lib/container-stack-grouping.ts`
- `cmdk`

**Edit (backend):**
- `packages/security/src/models/pcap.ts` (`search` in `CaptureListQuerySchema`)
- `packages/security/src/services/pcap-service.ts` (`listCaptures` passthrough)
- pcap-store (`getCaptures` parameterized search predicate)
- `packages/security/src/__tests__/pcap-route.test.ts`, `pcap-model.test.ts`, store/service test (add cases)

## Docs (project rule)

- `docs/architecture.md`: note the cross-endpoint capture target picker + the `search` param on the captures list.
- `.env.example`: no new variables.
- `CLAUDE.md`: short note on the packet-capture cross-endpoint search if behavior warrants.

## Security checklist touchpoints

- New `search` query param validated with Zod at the boundary (`max(200)`).
- SQL filter strictly parameterized (no concatenation).
- pcap routes remain admin-gated and `PCAP_ENABLED`-gated; no change to the auth posture.
- No new sensitive data exposed (container/endpoint names already returned by existing endpoints).
