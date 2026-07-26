/**
 * Reading what a language model actually supplied — and saying so when it
 * supplied nothing.
 *
 * The design critique found the same defect in three separate analysers: a
 * model that omitted its `confidence_score` had one invented for it (`0.5`,
 * `0.3`, `0.1` depending on the code path), and the UI then rendered that
 * constant as an authoritative "Confidence: 50%" badge. The number looked like
 * a measurement, was indistinguishable from one, and nothing had measured
 * anything.
 *
 * `null` is the honest answer, and it lets every caller omit the badge instead
 * of printing a stand-in. These helpers live in `core` rather than beside any
 * one analyser because all three consumers — remediation (`@dashboard/operations`),
 * investigation (`@dashboard/ai`) and PCAP analysis (`@dashboard/security`) —
 * are in different packages that may not import one another, and three copies
 * of a rule is how the rule comes back in one of them.
 */

/** The severities the analysis prompts ask a model to choose between. */
export type ModelSeverity = 'critical' | 'warning' | 'info';

/**
 * The model's confidence as a number in 0–1, or `null` when it did not supply a
 * usable one.
 *
 * `Number.isFinite` is load-bearing rather than defensive: a model that emits
 * `NaN` (or a JSON `"0.8"` string) would otherwise persist a value that renders
 * as "Confidence: NaN%" or crashes the formatter. Out-of-range numbers are
 * clamped rather than rejected — the model did express a judgement, it just
 * expressed it badly.
 */
export function clampConfidenceScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

/**
 * The model's severity, or `null` when it did not supply a valid one.
 *
 * Never falls back to a middle value: a fabricated "warning" badge is read by
 * an operator as an assessment, and triaging against it wastes the one thing
 * an incident costs most.
 */
export function parseSeverity(value: unknown): ModelSeverity | null {
  return value === 'critical' || value === 'warning' || value === 'info' ? value : null;
}
