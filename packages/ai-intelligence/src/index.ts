// Public API for the @dashboard/ai package.

// Routes
export {
  monitoringRoutes,
  investigationRoutes,
  incidentsRoutes,
  correlationRoutes,
  llmRoutes,
  llmObservabilityRoutes,
  llmFeedbackRoutes,
  mcpRoutes,
  promptProfileRoutes,
} from './routes/index.js';
export type {
  MonitoringRoutesOpts,
  CorrelationRoutesOpts,
  CorrelationPair,
  CorrelationInsight,
  Queryable,
} from './routes/index.js';

// Sockets
export { setupLlmNamespace, setupMonitoringNamespace, broadcastInsight, broadcastInsightBatch } from './sockets/index.js';

// Services — monitoring orchestration
export {
  createMonitoringService,
  setMonitoringNamespace,
  sweepExpiredCooldowns,
  resetAnomalyCooldowns,
  startCooldownSweep,
  stopCooldownSweep,
} from './services/monitoring-service.js';
export type { MonitoringDeps } from './services/monitoring-service.js';

// Services — LLM client
export { isOllamaAvailable, ensureModel, chatStream, buildInfrastructureContext } from './services/llm-client.js';

// Services — insights
export { cleanupOldInsights } from './services/insights-store.js';

// Services — prompt store
export { PROMPT_FEATURES, DEFAULT_PROMPTS, getEffectivePrompt } from './services/prompt-store.js';

// Services — prompt version store
export {
  createPromptVersion,
  getPromptHistory,
  getPromptVersionById,
} from './services/prompt-version-store.js';

// Services — investigation
export { triggerInvestigation, initInvestigationDeps, setInvestigationNamespace } from './services/investigation-service.js';
export type { InvestigationMetricsDeps } from './services/investigation-service.js';

// Services — prompt guard
export { getPromptGuardNearMissTotal } from './services/prompt-guard.js';

// Services — MCP
export { autoConnectAll, disconnectAll } from './services/mcp-manager.js';

// Services — anomaly detection
export { detectAnomaly } from './services/anomaly-detector.js';
export { detectAnomalyAdaptive, detectAnomaliesBatch } from './services/adaptive-anomaly-detector.js';
export { correlateInsights } from './services/incident-correlator.js';
