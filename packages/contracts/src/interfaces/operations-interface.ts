import type { Insight } from '../schemas/insight.js';
import type { RationaleSource } from '../schemas/remediation.js';

/** Result of a suggested remediation action. */
export interface SuggestActionResult {
  actionId: string;
  actionType: string;
  /**
   * Where the rationale stored on the action came from. Always `pattern-match`
   * at suggestion time — the LLM analysis, if any, replaces it asynchronously.
   */
  rationaleSource?: RationaleSource;
  /** Stable id of the keyword rule that matched (see ACTION_PATTERNS). */
  patternId?: string;
}

/**
 * Abstract interface for operations/remediation access.
 * Implemented by @dashboard/operations.
 * Injected into monitoring-service to break the ai-intelligence → operations import cycle.
 */
export interface OperationsInterface {
  /**
   * Suggest a remediation action for an insight.
   * Returns the suggested action metadata, or null if no action was appropriate.
   */
  suggestAction(insight: Insight): Promise<SuggestActionResult | null>;
}
