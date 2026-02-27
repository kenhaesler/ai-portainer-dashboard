import type { Insight } from '../schemas/insight.js';

/** Result of a suggested remediation action. */
export interface SuggestActionResult {
  actionId: string;
  actionType: string;
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
