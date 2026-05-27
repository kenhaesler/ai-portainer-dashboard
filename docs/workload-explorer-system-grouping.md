# Workload Explorer System Grouping

Issue: #595

## Summary

Workload Explorer supports a container group filter with:

- `System`: operational agents (Edge Agent + Beyla)
- `Workload`: regular application containers

The CSV export action exports the currently visible (filtered) rows.

## Classification rules

A container is classified as `System` when **any** of the following match:

1. Container name contains one of:
- `beyla`
- `edge-agent`
- `edge_agent`
- `edgeagent`

2. Container image contains one of:
- `grafana/beyla`
- `/beyla`
- `portainer/agent`
- `edge-agent`

3. Combined label key/value text contains one of:
- `io.portainer.agent`
- `edge_id`
- `edgekey`
- `beyla-ebpf`
- `grafana/beyla`

If no rule matches, the container is classified as `Workload`.

## Table columns

Issue: #1288

The on-screen table renders the following columns, in order:

| Column     | Source                                            | Notes                                                                 |
|------------|---------------------------------------------------|-----------------------------------------------------------------------|
| Name       | `container.name`                                  | Clickable tag linking to the container detail page; single-line tag.  |
| Stackname  | resolved via `resolveContainerStackName`          | Clickable tag that filters the table by stack; single-line tag.       |
| State      | `container.state`                                 | Rendered via `StatusBadge`.                                           |
| Endpoint   | `container.endpointName`                          | Blue tag.                                                             |
| Imagename  | `container.image` → `getImageShortName(image)`    | Shows only the segment after the last `/`; full path on `title` hover.|
| Group      | `getContainerGroupLabel(container)`               | `System` or `Workload`.                                               |
| Actions    | —                                                 | Hover-revealed "view details" + "view logs" buttons.                  |

Performance-oriented metrics columns (`Rate (/s)`, `Errors`, `p95 (ms)`, `Age`) were removed from the inventory view in #1288 — those signals live in the Trace Explorer / container detail page.

The Workload Explorer table uses the shared `DataTable`'s `windowScroll` mode, so the page (not the table) owns vertical scrolling and the full filtered list renders without pagination or an inner scrollbar.

## Export behavior

The `Export CSV` button exports the visible rows after endpoint/stack/group filters are applied.
The export includes columns:

- `name`
- `image`
- `group`
- `stack`
- `state`
- `status`
- `endpoint`
- `created`

The CSV column set is intentionally broader than the on-screen column set — operators can post-process CSV data offline.
