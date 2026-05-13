import { getDbForDomain } from '../db/app-db-router.js';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { Setting } from '../models/settings.js';

const log = createChildLogger('settings-store');

function db() {
  return getDbForDomain('settings');
}

export async function getSetting(key: string): Promise<Setting | null> {
  return db().queryOne<Setting>('SELECT * FROM settings WHERE key = ?', [key]);
}

export async function setSetting(key: string, value: string, category: string): Promise<void> {
  await db().execute(`
    INSERT INTO settings (key, value, category, updated_at)
    VALUES (?, ?, ?, NOW())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updated_at = NOW()
  `, [key, value, category]);

  log.debug({ key, category }, 'Setting saved');
}

export async function getSettings(category?: string): Promise<Setting[]> {
  if (category) {
    return db().query<Setting>('SELECT * FROM settings WHERE category = ? ORDER BY key ASC', [category]);
  }

  return db().query<Setting>('SELECT * FROM settings ORDER BY category ASC, key ASC');
}

/**
 * Read LLM config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 *
 * The dashboard targets a single OpenAI-compatible chat-completions API
 * (OpenAI, LM Studio, vLLM, LiteLLM, OpenWebUI, Anthropic via proxy, etc).
 * The bare base URL is sufficient — `/v1/chat/completions` is appended at
 * call time (see `resolveChatCompletionsUrl`).
 */
export async function getEffectiveLlmConfig() {
  const config = getConfig();
  const apiUrl = (await getSetting('llm.api_url'))?.value || config.LLM_API_URL || '';
  const apiToken = (await getSetting('llm.api_token'))?.value || config.LLM_API_TOKEN || '';
  const model = (await getSetting('llm.model'))?.value || config.LLM_MODEL;
  const authType = ((await getSetting('llm.auth_type'))?.value as 'bearer' | 'basic') || config.LLM_AUTH_TYPE;
  const rawMaxTokens = (await getSetting('llm.max_tokens'))?.value;
  const maxTokens = rawMaxTokens && rawMaxTokens.trim() !== ''
    ? Math.max(parseInt(rawMaxTokens, 10), 1) || 20000
    : 20000;
  const maxToolIterations = parseInt((await getSetting('llm.max_tool_iterations'))?.value || '', 10) || config.LLM_MAX_TOOL_ITERATIONS;
  return { apiUrl, apiToken, model, authType, maxTokens, maxToolIterations };
}

/**
 * Read MCP config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 */
export async function getEffectiveMcpConfig() {
  const config = getConfig();
  const toolTimeout = parseInt((await getSetting('mcp.tool_timeout'))?.value || '', 10) || config.MCP_TOOL_TIMEOUT;
  return { toolTimeout };
}

/**
 * Read Harbor config from the settings DB, falling back to env vars.
 * Called per-request so that Settings page changes take effect immediately.
 */
export async function getEffectiveHarborConfig() {
  const config = getConfig();
  const enabled = (await getSetting('harbor.enabled'))?.value === 'true' || config.HARBOR_SYNC_ENABLED;
  const apiUrl = (await getSetting('harbor.api_url'))?.value || config.HARBOR_API_URL;
  const robotName = (await getSetting('harbor.robot_name'))?.value || config.HARBOR_ROBOT_NAME;
  const robotSecret = (await getSetting('harbor.robot_secret'))?.value || config.HARBOR_ROBOT_SECRET;
  const verifySsl = ((await getSetting('harbor.verify_ssl'))?.value ?? String(config.HARBOR_VERIFY_SSL)) !== 'false';
  const syncIntervalMinutes = parseInt((await getSetting('harbor.sync_interval_minutes'))?.value || '', 10) || config.HARBOR_SYNC_INTERVAL_MINUTES;
  return { enabled, apiUrl, robotName, robotSecret, verifySsl, syncIntervalMinutes };
}

// ── Monitoring scheduler config ──────────────────────────────────────────────

/**
 * Read monitoring scheduler config from the Settings DB, falling back to env vars.
 * Called on each 1-minute tick so that Settings UI changes take effect without a restart.
 */
export async function getEffectiveMonitoringSchedulerConfig() {
  const cfg = getConfig();
  const enabledSetting = await getSetting('monitoring.enabled');
  const enabled = enabledSetting ? enabledSetting.value === 'true' : cfg.MONITORING_ENABLED;
  const intervalMinutes = parseInt((await getSetting('monitoring.scheduler_interval_minutes'))?.value || '', 10) || cfg.MONITORING_INTERVAL_MINUTES;
  return { enabled, intervalMinutes };
}

// ── Monitoring / AI Tuning config ────────────────────────────────────────────

export interface MonitoringConfig {
  // General
  aiAnalysisEnabled: boolean;
  maxInsightsPerCycle: number;
  logAnalysisConcurrency: number;
  maxLlmHistoryMessages: number;
  // Anomaly detection
  anomalyDetectionMethod: 'zscore' | 'bollinger' | 'adaptive';
  anomalyZscoreThreshold: number;
  anomalyMovingAverageWindow: number;
  anomalyMinSamples: number;
  anomalyCooldownMinutes: number;
  anomalyThresholdPct: number;
  anomalyHardThresholdEnabled: boolean;
  bollingerBandsEnabled: boolean;
  // Predictive alerting
  predictiveAlertingEnabled: boolean;
  predictiveAlertThresholdHours: number;
  // Anomaly explanation
  anomalyExplanationEnabled: boolean;
  anomalyExplanationMaxPerCycle: number;
  // Isolation Forest
  isolationForestEnabled: boolean;
  isolationForestRetrainHours: number;
  // NLP Log Analysis
  nlpLogAnalysisEnabled: boolean;
  nlpLogAnalysisMaxPerCycle: number;
  nlpLogAnalysisTailLines: number;
  // Smart grouping
  smartGroupingEnabled: boolean;
  smartGroupingSimilarityThreshold: number;
  incidentSummaryEnabled: boolean;
  // Investigation
  investigationEnabled: boolean;
  investigationCooldownMinutes: number;
  investigationMaxConcurrent: number;
  investigationLogTailLines: number;
  investigationMetricsWindowMinutes: number;
  investigationMinSeverity: 'critical' | 'warning' | 'info';
}

/**
 * Read AI tuning / monitoring config from the Settings DB (single batch query),
 * falling back to env vars for any missing keys.
 *
 * Designed to be called once at the top of each monitoring cycle — the cycle
 * itself acts as the cache boundary, so no TTL cache is needed.
 */
export async function getEffectiveMonitoringConfig(): Promise<MonitoringConfig> {
  const envCfg = getConfig();

  // Single batch query for all ai_tuning rows
  const rows = await getSettings('ai_tuning');
  const m = new Map(rows.map((r) => [r.key, r.value]));

  const str = (key: string, fallback: string): string => m.get(key) || fallback;
  const num = (key: string, fallback: number): number => {
    const v = m.get(key);
    if (v === undefined || v === '') return fallback;
    const parsed = parseFloat(v);
    return Number.isNaN(parsed) ? fallback : parsed;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = m.get(key);
    if (v === undefined || v === '') return fallback;
    return v === 'true';
  };

  return {
    aiAnalysisEnabled: bool('ai_tuning.ai_analysis_enabled', envCfg.AI_ANALYSIS_ENABLED),
    maxInsightsPerCycle: num('ai_tuning.max_insights_per_cycle', envCfg.MAX_INSIGHTS_PER_CYCLE),
    logAnalysisConcurrency: num('ai_tuning.log_analysis_concurrency', envCfg.LOG_ANALYSIS_CONCURRENCY),
    maxLlmHistoryMessages: num('ai_tuning.max_llm_history_messages', envCfg.MAX_LLM_HISTORY_MESSAGES),

    anomalyDetectionMethod: str('ai_tuning.anomaly_detection_method', envCfg.ANOMALY_DETECTION_METHOD) as MonitoringConfig['anomalyDetectionMethod'],
    anomalyZscoreThreshold: num('ai_tuning.anomaly_zscore_threshold', envCfg.ANOMALY_ZSCORE_THRESHOLD),
    anomalyMovingAverageWindow: num('ai_tuning.anomaly_moving_average_window', envCfg.ANOMALY_MOVING_AVERAGE_WINDOW),
    anomalyMinSamples: num('ai_tuning.anomaly_min_samples', envCfg.ANOMALY_MIN_SAMPLES),
    anomalyCooldownMinutes: num('ai_tuning.anomaly_cooldown_minutes', envCfg.ANOMALY_COOLDOWN_MINUTES),
    anomalyThresholdPct: num('ai_tuning.anomaly_threshold_pct', envCfg.ANOMALY_THRESHOLD_PCT),
    anomalyHardThresholdEnabled: bool('ai_tuning.anomaly_hard_threshold_enabled', envCfg.ANOMALY_HARD_THRESHOLD_ENABLED),
    bollingerBandsEnabled: bool('ai_tuning.bollinger_bands_enabled', envCfg.BOLLINGER_BANDS_ENABLED),

    predictiveAlertingEnabled: bool('ai_tuning.predictive_alerting_enabled', envCfg.PREDICTIVE_ALERTING_ENABLED),
    predictiveAlertThresholdHours: num('ai_tuning.predictive_alert_threshold_hours', envCfg.PREDICTIVE_ALERT_THRESHOLD_HOURS),

    anomalyExplanationEnabled: bool('ai_tuning.anomaly_explanation_enabled', envCfg.ANOMALY_EXPLANATION_ENABLED),
    anomalyExplanationMaxPerCycle: num('ai_tuning.anomaly_explanation_max_per_cycle', envCfg.ANOMALY_EXPLANATION_MAX_PER_CYCLE),

    isolationForestEnabled: bool('ai_tuning.isolation_forest_enabled', envCfg.ISOLATION_FOREST_ENABLED),
    isolationForestRetrainHours: num('ai_tuning.isolation_forest_retrain_hours', envCfg.ISOLATION_FOREST_RETRAIN_HOURS),

    nlpLogAnalysisEnabled: bool('ai_tuning.nlp_log_analysis_enabled', envCfg.NLP_LOG_ANALYSIS_ENABLED),
    nlpLogAnalysisMaxPerCycle: num('ai_tuning.nlp_log_analysis_max_per_cycle', envCfg.NLP_LOG_ANALYSIS_MAX_PER_CYCLE),
    nlpLogAnalysisTailLines: num('ai_tuning.nlp_log_analysis_tail_lines', envCfg.NLP_LOG_ANALYSIS_TAIL_LINES),

    smartGroupingEnabled: bool('ai_tuning.smart_grouping_enabled', envCfg.SMART_GROUPING_ENABLED),
    smartGroupingSimilarityThreshold: num('ai_tuning.smart_grouping_similarity_threshold', envCfg.SMART_GROUPING_SIMILARITY_THRESHOLD),
    incidentSummaryEnabled: bool('ai_tuning.incident_summary_enabled', envCfg.INCIDENT_SUMMARY_ENABLED),

    investigationEnabled: bool('ai_tuning.investigation_enabled', envCfg.INVESTIGATION_ENABLED),
    investigationCooldownMinutes: num('ai_tuning.investigation_cooldown_minutes', envCfg.INVESTIGATION_COOLDOWN_MINUTES),
    investigationMaxConcurrent: num('ai_tuning.investigation_max_concurrent', envCfg.INVESTIGATION_MAX_CONCURRENT),
    investigationLogTailLines: num('ai_tuning.investigation_log_tail_lines', envCfg.INVESTIGATION_LOG_TAIL_LINES),
    investigationMetricsWindowMinutes: num('ai_tuning.investigation_metrics_window_minutes', envCfg.INVESTIGATION_METRICS_WINDOW_MINUTES),
    investigationMinSeverity: str('ai_tuning.investigation_min_severity', envCfg.INVESTIGATION_MIN_SEVERITY) as MonitoringConfig['investigationMinSeverity'],
  };
}

export async function deleteSetting(key: string): Promise<boolean> {
  const result = await db().execute('DELETE FROM settings WHERE key = ?', [key]);

  if (result.changes > 0) {
    log.info({ key }, 'Setting deleted');
    return true;
  }
  return false;
}
