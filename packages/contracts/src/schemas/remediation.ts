import { z } from 'zod/v4';
import { SeveritySchema } from './insight.js';

export const ActionPrioritySchema = z.enum(['high', 'medium', 'low']);
export type ActionPriority = z.infer<typeof ActionPrioritySchema>;

export const RemediationSuggestedActionSchema = z.object({
  action: z.string(),
  priority: ActionPrioritySchema,
  rationale: z.string(),
});

/**
 * Where a rationale came from. `pattern-match` is a fixed string from the
 * five-entry regex table in `remediation-service.ts`; `llm-analysis` is model
 * output. The two render identically today, so the source travels with the
 * payload and the UI can label it honestly.
 */
export const RationaleSourceSchema = z.enum(['pattern-match', 'llm-analysis']);
export type RationaleSource = z.infer<typeof RationaleSourceSchema>;

export const RemediationAnalysisResultSchema = z.object({
  root_cause: z.string(),
  /**
   * Null when the model did not supply a severity. A fallback rendered as an
   * authoritative badge is worse than no badge — the UI must omit it on null
   * rather than substitute a default.
   */
  severity: SeveritySchema.nullable(),
  recommended_actions: z.array(RemediationSuggestedActionSchema),
  log_analysis: z.string(),
  /**
   * 0–1 when the model supplied one; null when it did not. Distinguishing the
   * two is the point: "Confidence: 50%" used to be a hardcoded default dressed
   * as a measurement.
   */
  confidence_score: z.number().min(0).max(1).nullable(),
  /** Present on stored analyses so the UI can attribute the text. */
  analysis_source: RationaleSourceSchema.optional(),
});

export type RemediationSuggestedAction = z.infer<typeof RemediationSuggestedActionSchema>;
export type RemediationAnalysisResult = z.infer<typeof RemediationAnalysisResultSchema>;
