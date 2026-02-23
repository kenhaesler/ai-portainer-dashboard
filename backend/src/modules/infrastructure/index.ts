// Edge agents
export { getEndpointCapabilities, assertCapability, supportsLiveFeatures, isEdgeStandard, isEdgeAsync } from './services/edge-capability-guard.js';
export type { CapabilityName } from './services/edge-capability-guard.js';
export { initiateEdgeAsyncLogCollection, checkEdgeJobStatus, retrieveEdgeJobLogs, cleanupEdgeJob, getEdgeAsyncContainerLogs } from './services/edge-async-log-fetcher.js';
export type { EdgeAsyncLogHandle, EdgeAsyncLogOptions, EdgeJobStatusResult } from './services/edge-async-log-fetcher.js';
export { getContainerLogsWithRetry, waitForTunnel, isDockerProxyUnavailable } from './services/edge-log-fetcher.js';
export { IncrementalDockerFrameDecoder } from './services/docker-frame-decoder.js';

// ELK
export { startElasticsearchLogForwarder, stopElasticsearchLogForwarder, runElasticsearchLogForwardingCycle, resetElasticsearchLogForwarderState } from './services/elasticsearch-log-forwarder.js';
export { getElasticsearchConfig } from './services/elasticsearch-config.js';
export type { ElasticsearchConfig } from './services/elasticsearch-config.js';
