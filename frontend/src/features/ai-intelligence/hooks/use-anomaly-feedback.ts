/**
 * "Mark as false positive" feedback hook for ML-detected anomalies (#1298).
 *
 * Two behaviours wrapped in one module:
 *   • useMarkFalsePositive — POST /api/monitoring/anomaly-feedback with
 *     optimistic local-state update. The card immediately hides via the
 *     `dismissedAnomalyIds` set; on error the dismissal is reverted.
 *   • useAnomalyFeedbackRates — GET /api/monitoring/anomaly-feedback/rates
 *     returns per-detector false-positive rate (caller-scoped unless the
 *     caller is admin).
 *
 * The optimistic-dismissal set is owned by the calling component
 * (`CorrelatedAnomalyCard`'s parent) and threaded through the mutation
 * options so the hook itself stays state-free and reusable.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { STALE_TIMES } from '@/shared/lib/query-constants';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────

export interface AnomalyFeedbackResponse {
  success: boolean;
  anomalyId: string;
  disposition: string;
  duplicate: boolean;
}

export interface DetectorRate {
  detector: string;
  anomalies: number;
  falsePositives: number;
  /** false-positive rate in [0, 1]. 0 when no anomalies have been surfaced. */
  rate: number;
}

export interface AnomalyFeedbackRatesResponse {
  rates: DetectorRate[];
  /** "fleet" for admins by default; "mine" for caller-scoped queries. */
  scope: 'fleet' | 'mine';
}

// ── Query keys ───────────────────────────────────────────────────────

const ANOMALY_FEEDBACK_KEYS = {
  all: ['anomaly-feedback'] as const,
  rates: (scope?: 'fleet' | 'mine') => ['anomaly-feedback', 'rates', scope] as const,
};

// ── POST /api/monitoring/anomaly-feedback ───────────────────────────

interface MarkFalsePositiveVars {
  anomalyId: string;
  /** Detector source — e.g. 'correlated-zscore', 'isolation-forest'. */
  detector?: string;
}

/**
 * Stable feedback key for a CorrelatedAnomaly. The card has no persisted
 * id (correlated anomalies are computed on demand and never written to
 * the insights table), so we derive one from `(containerId, timestamp)`
 * which uniquely identifies the snapshot the user is looking at.
 */
export function deriveCorrelatedAnomalyId(args: {
  containerId: string;
  timestamp: string;
}): string {
  return `correlated:${args.containerId}:${args.timestamp}`;
}

interface MarkFalsePositiveOptions {
  /** Called immediately before the network request to optimistically hide the card. */
  onOptimisticDismiss?: (anomalyId: string) => void;
  /** Called on network error to revert the optimistic dismissal. */
  onRevertDismiss?: (anomalyId: string) => void;
}

interface MutationContext {
  anomalyId: string;
}

export function useMarkFalsePositive(options: MarkFalsePositiveOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation<AnomalyFeedbackResponse, Error, MarkFalsePositiveVars, MutationContext>({
    mutationFn: async ({ anomalyId, detector }) => {
      return api.post<AnomalyFeedbackResponse>('/api/monitoring/anomaly-feedback', {
        anomalyId,
        disposition: 'false-positive',
        ...(detector ? { detector } : {}),
      });
    },
    onMutate: async ({ anomalyId }) => {
      // Optimistic dismissal — the parent owns the set of dismissed IDs.
      // We return the id in the context so onError can revert without
      // re-deriving it from `variables`.
      options.onOptimisticDismiss?.(anomalyId);
      return { anomalyId };
    },
    onError: (error, _vars, context) => {
      const id = context?.anomalyId;
      if (id) options.onRevertDismiss?.(id);
      toast.error('Failed to mark as false positive', {
        description: error.message,
      });
    },
    onSuccess: (data) => {
      // Refresh the per-detector rate badge after a confirmed write.
      // Duplicate submissions still invalidate (rate may be stale for
      // other reasons), but skip the toast to avoid double-confirmation.
      queryClient.invalidateQueries({ queryKey: ANOMALY_FEEDBACK_KEYS.all });
      if (!data.duplicate) {
        toast.success('Marked as false positive', {
          description: 'Thanks — your feedback informs detector tuning.',
        });
      }
    },
  });
}

// ── GET /api/monitoring/anomaly-feedback/rates ──────────────────────

export function useAnomalyFeedbackRates(scope?: 'fleet' | 'mine') {
  return useQuery<AnomalyFeedbackRatesResponse>({
    queryKey: ANOMALY_FEEDBACK_KEYS.rates(scope),
    queryFn: () =>
      api.get<AnomalyFeedbackRatesResponse>('/api/monitoring/anomaly-feedback/rates', {
        params: scope ? { scope } : undefined,
      }),
    staleTime: STALE_TIMES.MEDIUM,
    // Detectors with zero feedback still render the badge with rate=0,
    // so empty arrays are valid data, not an error.
    retry: 1,
  });
}
