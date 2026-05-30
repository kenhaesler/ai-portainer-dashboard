import { Activity, Shield, Sparkles, TrendingUp, FileText, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ParsedSignature {
  category: string;
  detectionMethod: string | null;
  metricType: string | null;
}

/**
 * Parse a backend signature string of the form
 *   `<category>:<detectionMethod>[:<metricType>]`
 * into structured fields. Returns `unknown` category for empty/malformed input;
 * for the `unknown:*` sentinel, downstream segments are not structured fields
 * (just a slug) so detectionMethod and metricType are null.
 *
 * Source format documented in packages/ai-intelligence/src/services/signature.ts.
 */
export function parseSignature(sig: string): ParsedSignature {
  if (!sig) return { category: 'unknown', detectionMethod: null, metricType: null };
  const parts = sig.split(':');
  const category = parts[0] ?? 'unknown';
  if (category === 'unknown') {
    return { category: 'unknown', detectionMethod: null, metricType: null };
  }
  const detectionMethod = parts[1] ?? null;
  const metricType = parts[2] ?? null;
  return { category, detectionMethod, metricType };
}

const DETECTION_METHOD_LABELS: Record<string, string> = {
  'ml-anomaly': 'ML',
  threshold: 'Threshold',
  prediction: 'Prediction',
  'health-check': 'Health Check',
  scan: 'Scan',
  pattern: 'Pattern',
  network: 'Network',
};

export function detectionMethodLabel(method: string | null): string | null {
  if (!method) return null;
  return DETECTION_METHOD_LABELS[method] ?? null;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  anomaly: Activity,
  predictive: TrendingUp,
  security: Shield,
  ai: Sparkles,
  log: FileText,
  config: Server,
};

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Server;
}
