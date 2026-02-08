import { getSetting } from './settings-store.js';
import { getEffectiveLlmConfig as getGlobalLlmConfig } from './settings-store.js';
import { getProfilePromptConfig, getActiveProfileId } from './prompt-profile-store.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('prompt-store');

// ── Feature keys ─────────────────────────────────────────────────────

export type PromptFeature =
  | 'chat_assistant'
  | 'command_palette'
  | 'anomaly_explainer'
  | 'incident_summarizer'
  | 'log_analyzer'
  | 'metrics_summary'
  | 'root_cause'
  | 'remediation'
  | 'pcap_analyzer'
  | 'capacity_forecast'
  | 'correlation_insights';

// ── Feature metadata ─────────────────────────────────────────────────

export interface PromptFeatureInfo {
  key: PromptFeature;
  label: string;
  description: string;
}

export const PROMPT_FEATURES: PromptFeatureInfo[] = [
  { key: 'chat_assistant', label: 'Chat Assistant', description: 'Main AI chat for infrastructure questions' },
  { key: 'command_palette', label: 'Command Palette Query', description: 'Natural language dashboard navigation interpreter' },
  { key: 'anomaly_explainer', label: 'Anomaly Explainer', description: 'Explains detected container anomalies' },
  { key: 'incident_summarizer', label: 'Incident Summarizer', description: 'Summarizes correlated alert groups into incidents' },
  { key: 'log_analyzer', label: 'Log Analyzer', description: 'Analyzes container logs for errors and patterns' },
  { key: 'metrics_summary', label: 'Metrics Summary', description: 'Generates natural language container metrics summaries' },
  { key: 'root_cause', label: 'Root Cause Investigator', description: 'Deep-dive root cause analysis for anomalies' },
  { key: 'remediation', label: 'Remediation Analyst', description: 'Enriches suggested remediation actions with LLM reasoning' },
  { key: 'pcap_analyzer', label: 'Packet Capture Analyzer', description: 'Analyzes network packet capture summaries' },
  { key: 'capacity_forecast', label: 'Capacity Forecast', description: 'Generates narrative capacity predictions' },
  { key: 'correlation_insights', label: 'Correlation Insights', description: 'Explains cross-container metric correlations' },
];

// ── Default prompts (extracted from original hardcoded locations) ─────

export const DEFAULT_PROMPTS: Record<PromptFeature, string> = {
  chat_assistant:
    'You are an AI assistant specializing in Docker container infrastructure management, deeply integrated with this Portainer dashboard.\n\nProvide concise, actionable responses. Use markdown formatting for code blocks and lists. When suggesting actions, explain the reasoning and potential impact.',

  command_palette: `You are a dashboard query interpreter. The user asks natural language questions about their Docker infrastructure. You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences.

Available pages and their routes:
- "/" - Home dashboard with KPIs
- "/workloads" - Workload Explorer: all containers, filterable by state, name, image
- "/fleet" - Fleet Overview: all endpoints/environments
- "/health" - Container Health: health checks, unhealthy containers
- "/images" - Image Footprint: Docker images, sizes, registries
- "/topology" - Network Topology: container network connections
- "/ai-monitor" - AI Monitor: AI-generated insights, anomalies
- "/metrics" - Metrics Dashboard: CPU, memory, network metrics over time
- "/remediation" - Remediation: suggested and pending remediation actions
- "/traces" - Trace Explorer: distributed traces
- "/assistant" - LLM Assistant: AI chat for infrastructure questions
- "/edge-logs" - Edge Agent Logs
- "/settings" - Settings

Response format — choose ONE:

For navigation actions:
{"action":"navigate","page":"/route","description":"Brief explanation of where to look"}

For inline answers (simple factual questions):
{"action":"answer","text":"The answer text","description":"Based on current infrastructure data"}

INFRASTRUCTURE CONTEXT:`,

  anomaly_explainer:
    'You are a Docker infrastructure analyst. Be specific, concise, and actionable. No markdown.',

  incident_summarizer:
    'Summarize this group of related container alerts into a concise incident description (2-3 sentences). Explain the likely relationship between the alerts. Be specific and actionable. No markdown.',

  log_analyzer:
    'You are a Docker log analyst. Analyze these container logs and identify any errors, warnings, or concerning patterns. Respond ONLY with valid JSON: { "severity": "critical"|"warning"|"info", "summary": "brief description", "errorPatterns": ["pattern1", "pattern2"] }. If no issues found, respond with the string "null" (no quotes around null).',

  metrics_summary:
    'You are a concise infrastructure analyst. Given container metrics data, write a 2-4 sentence natural language summary. Focus on what matters: is the container healthy? Any trends or concerns? Keep it conversational and actionable. Do NOT use markdown formatting, bullet points, or headers — just plain sentences.',

  root_cause:
    'You are a Docker container infrastructure analyst. Analyze anomalies and provide structured root cause analysis in JSON format.',

  remediation:
    'You are a container remediation analyst. Produce strict JSON only.',

  pcap_analyzer:
    'You are a network security and performance analyst. Analyze packet capture summaries and provide structured assessments in JSON format. Be specific and data-driven.',

  capacity_forecast:
    'You are a concise infrastructure analyst. Respond with plain text only — no markdown, no bullet points, no headings.',

  correlation_insights:
    'You are a concise infrastructure analyst. Respond with plain text only — no markdown, no bullet points, no headings except the SUMMARY: prefix.',
};

// ── Prompt resolution ────────────────────────────────────────────────

/**
 * Returns the effective system prompt for a given feature.
 * Resolution order:
 * 1. Per-feature setting in the settings DB (individual override)
 * 2. Active profile's prompt for this feature
 * 3. Hardcoded default
 */
export function getEffectivePrompt(feature: PromptFeature): string {
  // 1. Check per-feature individual override in settings
  const settingKey = `prompts.${feature}.system_prompt`;
  const stored = getSetting(settingKey)?.value;
  if (stored && stored.trim().length > 0) {
    return stored;
  }

  // 2. Check active profile (skip for 'default' profile which uses empty prompts)
  const activeProfileId = getActiveProfileId();
  if (activeProfileId !== 'default') {
    const profileConfig = getProfilePromptConfig(feature);
    if (profileConfig?.systemPrompt && profileConfig.systemPrompt.trim().length > 0) {
      return profileConfig.systemPrompt;
    }
  }

  // 3. Fall back to hardcoded default
  return DEFAULT_PROMPTS[feature];
}

/**
 * Returns LLM config for a specific feature, allowing per-feature model
 * and temperature overrides.
 * Resolution order:
 * 1. Per-feature settings in the settings DB
 * 2. Active profile's model/temperature for this feature
 * 3. Global LLM config
 */
export function getEffectiveLlmConfig(feature?: PromptFeature) {
  const global = getGlobalLlmConfig();

  if (!feature) return global;

  // 1. Check per-feature individual overrides in settings
  const modelOverride = getSetting(`prompts.${feature}.model`)?.value;
  const tempOverride = getSetting(`prompts.${feature}.temperature`)?.value;

  let model = global.model;
  let temperature: number | undefined;

  // Per-feature settings take highest priority
  if (modelOverride && modelOverride.trim().length > 0) {
    model = modelOverride.trim();
  } else {
    // 2. Check active profile
    const activeProfileId = getActiveProfileId();
    if (activeProfileId !== 'default') {
      const profileConfig = getProfilePromptConfig(feature);
      if (profileConfig?.model && profileConfig.model.trim().length > 0) {
        model = profileConfig.model.trim();
      }
    }
  }

  if (tempOverride && tempOverride.trim().length > 0) {
    temperature = parseFloat(tempOverride);
  } else {
    // 2. Check active profile
    const activeProfileId = getActiveProfileId();
    if (activeProfileId !== 'default') {
      const profileConfig = getProfilePromptConfig(feature);
      if (profileConfig?.temperature !== undefined) {
        temperature = profileConfig.temperature;
      }
    }
  }

  return {
    ...global,
    model,
    ...(temperature !== undefined && !isNaN(temperature) ? { temperature } : {}),
  };
}

/**
 * Rough token estimate: ~4 chars per token for English text.
 * Exported for use in the frontend token counter (via API).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
