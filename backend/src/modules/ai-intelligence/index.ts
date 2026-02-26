// Public API for the ai-intelligence module.
// Import from this file in cross-domain consumers (app.ts, index.ts, scheduler, other modules).

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

// Sockets
export { setupLlmNamespace, setupMonitoringNamespace, broadcastInsight, broadcastInsightBatch } from './sockets/index.js';

// Services — monitoring orchestration
export {
  runMonitoringCycle,
  setMonitoringNamespace,
  sweepExpiredCooldowns,
  resetAnomalyCooldowns,
  startCooldownSweep,
  stopCooldownSweep,
} from './services/monitoring-service.js';

// Services — LLM client
export { isOllamaAvailable, ensureModel, chatStream } from './services/llm-client.js';

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
export { triggerInvestigation, setInvestigationNamespace } from './services/investigation-service.js';

// Services — prompt guard
export { getPromptGuardNearMissTotal } from './services/prompt-guard.js';

// Services — MCP
export { autoConnectAll, disconnectAll } from './services/mcp-manager.js';
