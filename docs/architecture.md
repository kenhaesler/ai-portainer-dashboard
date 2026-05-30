# Architecture

This project's architecture documentation is maintained in [docs/ai-instructions/architecture.md](ai-instructions/architecture.md).

For detailed diagrams and data flow, see:
- [Architecture Overview](ai-instructions/architecture.md) — monorepo structure, dependency graph, and key patterns
- [Database Schema](ai-instructions/architecture.md#database-schema) — app (PostgreSQL) + metrics (TimescaleDB) tables
- [Data Flows](ai-instructions/architecture.md#data-flows) — metrics, monitoring/anomaly, remediation, and LLM chat paths
- [Background Scheduler](ai-instructions/architecture.md#background-scheduler) — interval jobs and cadences
- [Security Checklist](ai-instructions/security-checklist.md)
- [UI Design System](ai-instructions/ui-design-system.md)

## UI notes

- Global themed scrollbar styling lives in `frontend/src/index.css` (see the comment block `GLOBAL THEMED SCROLLBAR`). It applies to `html`/`body` and any element with the `.scrollbar-themed` opt-in class, reading `--color-foreground` via `color-mix` so all 16 themes share one rule. The sidebar (`aside nav`) keeps its hover-reveal behavior via cascade order.
- `.spotlight-card` in `frontend/src/index.css` deliberately omits `transform`. A transformed ancestor creates a containing block for `position: fixed` descendants, which breaks the placement of Radix popover/select portals (the dropdown ended up at viewport `0, 0` — see #1310). Use `isolation: isolate` or `will-change: transform` if a future change needs a stacking context or GPU layer on this card, never `transform`.
