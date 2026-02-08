import { useState, useMemo, useCallback } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Trash2,
  Sparkles,
  Loader2,
  MessageSquare,
  Filter,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Copy,
  Check,
  Eye,
} from 'lucide-react';
import {
  useFeedbackStats,
  useRecentNegativeFeedback,
  useFeedbackList,
  useReviewFeedback,
  useBulkDeleteFeedback,
  useGenerateSuggestion,
  usePromptSuggestions,
  useUpdateSuggestionStatus,
  type FeedbackStats,
  type LlmFeedback,
  type PromptSuggestion,
} from '@/hooks/use-llm-feedback';
import { cn, formatDate } from '@/lib/utils';

// ── Feature label map ───────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  chat_assistant: 'Chat Assistant',
  command_palette: 'Command Palette',
  anomaly_explainer: 'Anomaly Explainer',
  incident_summarizer: 'Incident Summarizer',
  log_analyzer: 'Log Analyzer',
  metrics_summary: 'Metrics Summary',
  root_cause: 'Root Cause',
  remediation: 'Remediation',
  pcap_analyzer: 'Packet Capture',
  capacity_forecast: 'Capacity Forecast',
  correlation_insights: 'Correlations',
};

function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

// ── Main Panel Component ────────────────────────────────────────────

export function AiFeedbackPanel() {
  const [activeSection, setActiveSection] = useState<'overview' | 'feedback' | 'suggestions'>('overview');

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Review user feedback on AI-generated outputs, manage feedback quality, and use AI to generate prompt improvement suggestions.
        </p>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-1 border-b border-border/50">
        <SectionButton
          active={activeSection === 'overview'}
          onClick={() => setActiveSection('overview')}
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="Overview"
        />
        <SectionButton
          active={activeSection === 'feedback'}
          onClick={() => setActiveSection('feedback')}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="All Feedback"
        />
        <SectionButton
          active={activeSection === 'suggestions'}
          onClick={() => setActiveSection('suggestions')}
          icon={<Lightbulb className="h-3.5 w-3.5" />}
          label="Prompt Suggestions"
        />
      </div>

      {/* Content */}
      {activeSection === 'overview' && <OverviewSection />}
      {activeSection === 'feedback' && <FeedbackListSection />}
      {activeSection === 'suggestions' && <SuggestionsSection />}
    </div>
  );
}

function SectionButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-b-2 border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Overview Section ────────────────────────────────────────────────

function OverviewSection() {
  const { data: stats, isLoading: statsLoading } = useFeedbackStats();
  const { data: recentNegative, isLoading: negativeLoading } = useRecentNegativeFeedback();

  if (statsLoading || negativeLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalFeedback = stats?.reduce((sum, s) => sum + s.total, 0) ?? 0;
  const totalPositive = stats?.reduce((sum, s) => sum + s.positive, 0) ?? 0;
  const totalNegative = stats?.reduce((sum, s) => sum + s.negative, 0) ?? 0;
  const overallRate = totalFeedback > 0 ? Math.round((totalPositive / totalFeedback) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4" data-testid="feedback-kpis">
        <KpiCard
          label="Total Feedback"
          value={totalFeedback}
          icon={<MessageSquare className="h-4 w-4 text-blue-500" />}
        />
        <KpiCard
          label="Positive"
          value={totalPositive}
          icon={<ThumbsUp className="h-4 w-4 text-emerald-500" />}
        />
        <KpiCard
          label="Negative"
          value={totalNegative}
          icon={<ThumbsDown className="h-4 w-4 text-amber-500" />}
        />
        <KpiCard
          label="Satisfaction Rate"
          value={`${overallRate}%`}
          icon={<BarChart3 className="h-4 w-4 text-purple-500" />}
        />
      </div>

      {/* Per-feature stats */}
      {stats && stats.length > 0 && (
        <div className="rounded-lg border" data-testid="feature-stats-table">
          <div className="border-b bg-muted/30 px-4 py-2">
            <h3 className="text-sm font-medium">Per-Feature Statistics</h3>
          </div>
          <div className="divide-y">
            {stats.map((stat) => (
              <FeatureStatRow key={stat.feature} stat={stat} />
            ))}
          </div>
        </div>
      )}

      {/* Recent negative feedback */}
      {recentNegative && recentNegative.length > 0 && (
        <div className="rounded-lg border" data-testid="recent-negative-section">
          <div className="border-b bg-muted/30 px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-medium">Recent Negative Feedback</h3>
          </div>
          <div className="divide-y max-h-[400px] overflow-y-auto">
            {recentNegative.slice(0, 10).map((fb) => (
              <NegativeFeedbackRow key={fb.id} feedback={fb} />
            ))}
          </div>
        </div>
      )}

      {totalFeedback === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
          <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-sm font-medium text-muted-foreground">No feedback yet</h3>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm">
            Feedback will appear here as users rate AI-generated outputs across the dashboard.
          </p>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function FeatureStatRow({ stat }: { stat: FeedbackStats }) {
  const barWidth = stat.total > 0 ? (stat.positive / stat.total) * 100 : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="w-36 text-sm font-medium truncate">{featureLabel(stat.feature)}</div>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums shrink-0">
        <span className="flex items-center gap-1">
          <ThumbsUp className="h-3 w-3 text-emerald-500" />
          {stat.positive}
        </span>
        <span className="flex items-center gap-1">
          <ThumbsDown className="h-3 w-3 text-amber-500" />
          {stat.negative}
        </span>
        <span className="w-10 text-right font-medium">
          {stat.satisfactionRate}%
        </span>
        {stat.pendingCount > 0 && (
          <span className="rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-medium">
            {stat.pendingCount} pending
          </span>
        )}
      </div>
    </div>
  );
}

function NegativeFeedbackRow({ feedback }: { feedback: LlmFeedback }) {
  const reviewFeedback = useReviewFeedback();

  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5">
          {featureLabel(feedback.feature)}
        </span>
        <StatusBadge status={feedback.admin_status} />
        <span className="text-[10px] text-muted-foreground ml-auto">
          {formatDate(feedback.created_at)}
        </span>
      </div>
      {feedback.comment && (
        <p className="text-xs text-foreground/80">{feedback.comment}</p>
      )}
      {!feedback.comment && (
        <p className="text-xs text-muted-foreground italic">No comment provided</p>
      )}
      {feedback.admin_status === 'pending' && (
        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={() => reviewFeedback.mutate({ id: feedback.id, action: 'approved' })}
            disabled={reviewFeedback.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            Approve
          </button>
          <button
            onClick={() => reviewFeedback.mutate({ id: feedback.id, action: 'rejected' })}
            disabled={reviewFeedback.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <XCircle className="h-2.5 w-2.5" />
            Reject
          </button>
          <button
            onClick={() => reviewFeedback.mutate({ id: feedback.id, action: 'overruled', note: 'Admin override' })}
            disabled={reviewFeedback.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Overrule
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { className: string; label: string }> = {
    pending: { className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400', label: 'Pending' },
    approved: { className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', label: 'Approved' },
    rejected: { className: 'bg-red-500/10 text-red-600 dark:text-red-400', label: 'Rejected' },
    overruled: { className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400', label: 'Overruled' },
  };
  const c = config[status] ?? config.pending;

  return (
    <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5', c.className)}>
      {c.label}
    </span>
  );
}

// ── Feedback List Section ───────────────────────────────────────────

function FeedbackListSection() {
  const [featureFilter, setFeatureFilter] = useState<string>('');
  const [ratingFilter, setRatingFilter] = useState<'positive' | 'negative' | ''>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const limit = 25;

  const { data, isLoading } = useFeedbackList({
    feature: featureFilter || undefined,
    rating: (ratingFilter || undefined) as 'positive' | 'negative' | undefined,
    adminStatus: statusFilter || undefined,
    limit,
    offset: page * limit,
  });

  const reviewFeedback = useReviewFeedback();
  const bulkDelete = useBulkDeleteFeedback();

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    bulkDelete.mutate(
      { ids: Array.from(selectedIds) },
      { onSuccess: () => setSelectedIds(new Set()) },
    );
  }, [selectedIds, bulkDelete]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="feedback-filters">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={featureFilter}
          onChange={e => { setFeatureFilter(e.target.value); setPage(0); }}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="">All features</option>
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={ratingFilter}
          onChange={e => { setRatingFilter(e.target.value as typeof ratingFilter); setPage(0); }}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="">All ratings</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="overruled">Overruled</option>
        </select>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkDelete}
            disabled={bulkDelete.isPending}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            data-testid="bulk-delete-button"
          >
            <Trash2 className="h-3 w-3" />
            Delete {selectedIds.size} selected
          </button>
        )}
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No feedback entries found.</p>
      ) : (
        <div className="rounded-lg border divide-y" data-testid="feedback-list-table">
          {items.map((fb) => (
            <FeedbackRow
              key={fb.id}
              feedback={fb}
              selected={selectedIds.has(fb.id)}
              onToggleSelect={() => toggleSelect(fb.id)}
              onReview={(action, note) => reviewFeedback.mutate({ id: fb.id, action, note })}
              reviewing={reviewFeedback.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{total} total entries</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded px-2 py-1 border hover:bg-muted disabled:opacity-50"
            >
              Previous
            </button>
            <span>Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded px-2 py-1 border hover:bg-muted disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackRow({
  feedback,
  selected,
  onToggleSelect,
  onReview,
  reviewing,
}: {
  feedback: LlmFeedback;
  selected: boolean;
  onToggleSelect: () => void;
  onReview: (action: 'approved' | 'rejected' | 'overruled', note?: string) => void;
  reviewing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn('px-4 py-2.5', selected && 'bg-muted/30')}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="rounded border-input"
          aria-label={`Select feedback ${feedback.id}`}
        />
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {feedback.rating === 'positive' ? (
          <ThumbsUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        ) : (
          <ThumbsDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        )}
        <span className="text-xs font-medium">{featureLabel(feedback.feature)}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">
          {feedback.comment ?? 'No comment'}
        </span>
        <StatusBadge status={feedback.admin_status} />
        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
          {formatDate(feedback.created_at)}
        </span>
      </div>

      {expanded && (
        <div className="mt-2 ml-14 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">User:</span> {feedback.user_id}</div>
            <div><span className="text-muted-foreground">Effective:</span> {feedback.effective_rating ?? 'N/A'}</div>
            {feedback.admin_note && (
              <div className="col-span-2"><span className="text-muted-foreground">Admin note:</span> {feedback.admin_note}</div>
            )}
            {feedback.reviewed_by && (
              <div><span className="text-muted-foreground">Reviewed by:</span> {feedback.reviewed_by}</div>
            )}
          </div>
          {feedback.admin_status === 'pending' && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onReview('approved')}
                disabled={reviewing}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="h-2.5 w-2.5" /> Approve
              </button>
              <button
                onClick={() => onReview('rejected')}
                disabled={reviewing}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <XCircle className="h-2.5 w-2.5" /> Reject
              </button>
              <button
                onClick={() => onReview('overruled', 'Admin override')}
                disabled={reviewing}
                className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Overrule
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Suggestions Section ─────────────────────────────────────────────

function SuggestionsSection() {
  const { data: suggestions, isLoading } = usePromptSuggestions();
  const { data: stats } = useFeedbackStats();
  const generateSuggestion = useGenerateSuggestion();
  const updateStatus = useUpdateSuggestionStatus();

  // Features eligible for suggestion generation (10+ negative)
  const eligibleFeatures = useMemo(() => {
    return (stats ?? []).filter(s => s.negative >= 10).map(s => s.feature);
  }, [stats]);

  const [selectedFeature, setSelectedFeature] = useState<string>('');

  const handleGenerate = useCallback(() => {
    if (!selectedFeature) return;
    generateSuggestion.mutate({ feature: selectedFeature });
  }, [selectedFeature, generateSuggestion]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Generate new suggestion */}
      <div className="rounded-lg border p-4 space-y-3" data-testid="generate-suggestion-section">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <h3 className="text-sm font-medium">Generate Prompt Improvement</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          The AI will analyze negative feedback patterns for the selected feature and suggest an improved system prompt.
          A minimum of 10 negative feedback entries is required.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={selectedFeature}
            onChange={e => setSelectedFeature(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs flex-1 max-w-xs"
            data-testid="suggestion-feature-select"
          >
            <option value="">Select feature...</option>
            {eligibleFeatures.map(f => (
              <option key={f} value={f}>{featureLabel(f)}</option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={!selectedFeature || generateSuggestion.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="generate-suggestion-button"
          >
            {generateSuggestion.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Generate Suggestion
          </button>
        </div>
        {eligibleFeatures.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No features have enough negative feedback yet. Need at least 10 negative entries per feature.
          </p>
        )}
      </div>

      {/* Existing suggestions */}
      {suggestions && suggestions.length > 0 ? (
        <div className="space-y-4" data-testid="suggestions-list">
          {suggestions.map(s => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onUpdateStatus={(status) => updateStatus.mutate({ id: s.id, status })}
              updating={updateStatus.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No suggestions yet</p>
          <p className="text-xs mt-1">Generate a suggestion above when enough feedback is collected.</p>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onUpdateStatus,
  updating,
}: {
  suggestion: PromptSuggestion;
  onUpdateStatus: (status: 'applied' | 'dismissed' | 'edited') => void;
  updating: boolean;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(suggestion.suggested_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied
    }
  }, [suggestion.suggested_prompt]);

  const statusConfig: Record<string, { className: string; label: string }> = {
    pending: { className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', label: 'Pending Review' },
    applied: { className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', label: 'Applied' },
    dismissed: { className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400', label: 'Dismissed' },
    edited: { className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', label: 'Edited & Applied' },
  };

  const sc = statusConfig[suggestion.status] ?? statusConfig.pending;

  return (
    <div className="rounded-lg border" data-testid={`suggestion-card-${suggestion.id}`}>
      <div className="border-b p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">{featureLabel(suggestion.feature)}</span>
          <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5', sc.className)}>
            {sc.label}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            Based on {suggestion.negative_count} negative reviews
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{suggestion.reasoning}</p>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Eye className="h-3 w-3" />
            {showDiff ? 'Hide' : 'Show'} prompt comparison
          </button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy suggested prompt'}
          </button>
        </div>

        {showDiff && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-red-500">Current</span>
              <pre className="text-[11px] whitespace-pre-wrap rounded-md border bg-red-500/5 p-2 max-h-48 overflow-y-auto">
                {suggestion.current_prompt}
              </pre>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-emerald-500">Suggested</span>
              <pre className="text-[11px] whitespace-pre-wrap rounded-md border bg-emerald-500/5 p-2 max-h-48 overflow-y-auto">
                {suggestion.suggested_prompt}
              </pre>
            </div>
          </div>
        )}

        {suggestion.status === 'pending' && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onUpdateStatus('applied')}
              disabled={updating}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" />
              Apply Suggestion
            </button>
            <button
              onClick={() => onUpdateStatus('edited')}
              disabled={updating}
              className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
            >
              Edit Before Applying
            </button>
            <button
              onClick={() => onUpdateStatus('dismissed')}
              disabled={updating}
              className="inline-flex items-center gap-1 rounded-md border border-gray-500/30 bg-gray-500/10 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-500/20 transition-colors disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
