import type { Insight } from '@dashboard/core/models/monitoring.js';

type DerivableInsight = Pick<Insight, 'category' | 'metric_type' | 'detection_method' | 'title'>;

const SIGNATURE_LABELS: Record<string, string> = {
  'anomaly:ml-anomaly:cpu': 'Anomalous CPU usage (ML)',
  'anomaly:ml-anomaly:memory': 'Anomalous memory usage (ML)',
  'anomaly:threshold:cpu': 'High CPU usage',
  'anomaly:threshold:memory': 'High memory usage',
  'predictive:prediction:cpu': 'Predicted CPU exhaustion',
  'predictive:prediction:memory': 'Predicted memory exhaustion',
  'predictive:prediction:disk': 'Predicted disk exhaustion',
  'config:health-check:missing': 'Missing health check',
  'config:network:host-mode': 'Host network mode',
  'security:scan': 'Security scan finding',
  'log:pattern': 'Log pattern detected',
  'ai:analysis': 'AI analysis finding',
};

export function deriveSignature(input: DerivableInsight): string {
  if (input.metric_type && input.detection_method) {
    return `${input.category}:${input.detection_method}:${input.metric_type}`;
  }
  if (input.category === 'security') return 'security:scan';
  if (input.category === 'log-analysis') return 'log:pattern';
  if (input.category === 'ai-analysis') return 'ai:analysis';
  return deriveSignatureFromTitle(input.title);
}

const TITLE_RULES: Array<{ rx: RegExp; signature: (m: RegExpExecArray) => string }> = [
  // Predictions: "Predicted memory exhaustion …"
  {
    rx: /predicted\s+(cpu|memory|disk)\s+exhaustion/i,
    signature: (m) => `predictive:prediction:${m[1].toLowerCase()}`,
  },
  // Anomalous via ML: "Anomalous cpu usage on "x" (ML-detected)"
  {
    rx: /anomalous\s+(cpu|memory|disk)\s+usage[^()]*\(ml-detected\)/i,
    signature: (m) => `anomaly:ml-anomaly:${m[1].toLowerCase()}`,
  },
  // Anomalous threshold: "Anomalous cpu usage on "x"" (no ML qualifier)
  {
    rx: /anomalous\s+(cpu|memory|disk)\s+usage/i,
    signature: (m) => `anomaly:threshold:${m[1].toLowerCase()}`,
  },
  // Threshold: "High cpu usage on "x""
  {
    rx: /high\s+(cpu|memory|disk)\s+usage/i,
    signature: (m) => `anomaly:threshold:${m[1].toLowerCase()}`,
  },
  // Config: missing health check
  {
    rx: /no health check (configured|defined)|missing health check/i,
    signature: () => 'config:health-check:missing',
  },
  // Config: host network mode
  {
    rx: /host network mode/i,
    signature: () => 'config:network:host-mode',
  },
];

export function deriveSignatureFromTitle(title: string): string {
  for (const rule of TITLE_RULES) {
    const m = rule.rx.exec(title);
    if (m) return rule.signature(m);
  }
  return `unknown:${slugifyTitle(title)}`;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[",]/g, '')          // strip commas (URL separator) and quotes
    .replace(/[^a-z0-9]+/g, '-')   // any non-alnum → dash
    .replace(/^-+|-+$/g, '')       // trim dashes
    .slice(0, 80);                  // bound length
}

export function signatureLabel(signature: string): string {
  return SIGNATURE_LABELS[signature] ?? humanizeSignature(signature);
}

function humanizeSignature(signature: string): string {
  const parts = signature.split(':').map((s) => s.replace(/-/g, ' '));
  return parts
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' · ');
}

export { SIGNATURE_LABELS };
