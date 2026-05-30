# Package: contracts

Shared Zod schemas, TypeScript interfaces, and typed event definitions.
Foundation of the monorepo — every domain package depends on this package.

**Zero implementation rule:** This package contains ONLY types, interfaces, Zod schemas, and event
definitions. Never add runtime logic, service code, or external dependencies beyond `zod`.

## Structure

| Directory | Purpose |
|-----------|---------|
| `schemas/` | Zod schemas: container, endpoint, incident, insight, investigation, metric, remediation, security-finding |
| `interfaces/` | Service contracts: LLMInterface, MetricsInterface, InfrastructureLogsInterface, NotificationInterface, OperationsInterface, SecurityScannerInterface |
| `events.ts` | Typed event definitions for the cross-package event bus |

## Key Rules

- **No implementation code** — interfaces and Zod schemas only
- **No domain package imports** — depends only on `zod`
- Adding a new cross-domain contract? Define it here, implement it in domain packages, wire it in `@dashboard/server/src/wiring.ts`
