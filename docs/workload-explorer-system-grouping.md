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
