import { z } from 'zod/v4';
import { SeveritySchema } from './insight.js';

export const ActionPrioritySchema = z.enum(['high', 'medium', 'low']);
export type ActionPriority = z.infer<typeof ActionPrioritySchema>;

export const RemediationSuggestedActionSchema = z.object({
  action: z.string(),
  priority: ActionPrioritySchema,
  rationale: z.string(),
});

export const RemediationAnalysisResultSchema = z.object({
  root_cause: z.string(),
  severity: SeveritySchema,
  recommended_actions: z.array(RemediationSuggestedActionSchema),
  log_analysis: z.string(),
  confidence_score: z.number().min(0).max(1),
});

export type RemediationSuggestedAction = z.infer<typeof RemediationSuggestedActionSchema>;
export type RemediationAnalysisResult = z.infer<typeof RemediationAnalysisResultSchema>;
