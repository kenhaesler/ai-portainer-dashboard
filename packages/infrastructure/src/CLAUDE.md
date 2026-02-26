# Module: infrastructure

Edge agent capabilities, async log collection, Docker frame decoding,
and Elasticsearch log forwarding.

## Public API (barrel: `index.ts`)

```typescript
import { getEndpointCapabilities, assertCapability, isEdgeAsync } from '../../infrastructure/index.js';
import { getContainerLogsWithRetry, getEdgeAsyncContainerLogs } from '../../infrastructure/index.js';
import { IncrementalDockerFrameDecoder } from '../../infrastructure/index.js';
import { startElasticsearchLogForwarder, getElasticsearchConfig } from '../../infrastructure/index.js';
```

**Note:** Routes are imported directly from `routes/index.ts` in `app.ts` (not from barrel).

## Cross-domain Imports

None — depends only on `core/`.

## Key Rules

- Always call `assertCapability()` before edge-specific features in routes
- Docker frame decoder required for all container log streams
