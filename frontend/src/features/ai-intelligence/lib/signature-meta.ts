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

// Re-exported from the shared map so the incident groups and the insight feed
// cannot label one detector differently. This file used to keep its own copy,
// which said "ML" where the feed said "Metric anomaly" — on the same screen.
export { detectionMethodLabel } from './detection-method-labels';

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
