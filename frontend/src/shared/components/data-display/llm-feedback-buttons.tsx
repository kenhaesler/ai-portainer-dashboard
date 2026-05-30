import { useState, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Send, X } from 'lucide-react';
import { useSubmitFeedback } from '@/features/ai-intelligence/hooks/use-llm-feedback';
import { cn } from '@/shared/lib/utils';

interface LlmFeedbackButtonsProps {
  /** The LLM feature that generated this output */
  feature: string;
  /** Optional trace ID linking to llm_traces table */
  traceId?: string;
  /** Message ID for chat messages */
  messageId?: string;
  /** Preview of the LLM response for admin review */
  responsePreview?: string;
  /** The user query that triggered this LLM response */
  userQuery?: string;
  /** Compact mode for inline displays */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function LlmFeedbackButtons({
  feature,
  traceId,
  messageId,
  responsePreview,
  userQuery,
  compact = false,
  className,
}: LlmFeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<'positive' | 'negative' | null>(null);
  const [pendingRating, setPendingRating] = useState<'positive' | 'negative' | null>(null);
  const [comment, setComment] = useState('');
  const submitFeedback = useSubmitFeedback();

  const handleThumbClick = useCallback((rating: 'positive' | 'negative') => {
    if (submitted) return;
    setPendingRating(rating);
  }, [submitted]);

  const handleSubmitFeedback = useCallback(() => {
    if (!pendingRating) return;
    submitFeedback.mutate(
      {
        feature,
        traceId,
        messageId,
        rating: pendingRating,
        comment: comment.trim() || undefined,
        responsePreview,
        userQuery,
      },
      {
        onSuccess: () => {
          setSubmitted(pendingRating);
          setPendingRating(null);
          setComment('');
        },
      },
    );
  }, [feature, traceId, messageId, pendingRating, comment, responsePreview, userQuery, submitFeedback]);

  const handleCancelComment = useCallback(() => {
    setPendingRating(null);
    setComment('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitFeedback();
    }
    if (e.key === 'Escape') {
      handleCancelComment();
    }
  }, [handleSubmitFeedback, handleCancelComment]);

  // After feedback is submitted, show a minimal confirmation
  if (submitted) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 text-xs text-muted-foreground',
          compact ? 'mt-0.5' : 'mt-1',
          className,
        )}
        data-testid="feedback-submitted"
      >
        {submitted === 'positive' ? (
          <ThumbsUp className="h-3 w-3 text-emerald-500" />
        ) : (
          <ThumbsDown className="h-3 w-3 text-amber-500" />
        )}
        <span>Thanks for your feedback</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1.5', compact ? 'mt-0.5' : 'mt-1', className)}>
      {/* Thumbs buttons */}
      <div className="flex items-center gap-1" data-testid="feedback-buttons">
        <button
          onClick={() => handleThumbClick('positive')}
          disabled={submitFeedback.isPending}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors',
            'hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            pendingRating === 'positive' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          )}
          aria-label="Good response"
          title="Good response"
          data-testid="feedback-thumbs-up"
        >
          <ThumbsUp className={cn('h-3 w-3', compact ? '' : 'h-3.5 w-3.5')} />
        </button>
        <button
          onClick={() => handleThumbClick('negative')}
          disabled={submitFeedback.isPending}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors',
            'hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            pendingRating === 'negative' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
          )}
          aria-label="Poor response"
          title="Poor response"
          data-testid="feedback-thumbs-down"
        >
          <ThumbsDown className={cn('h-3 w-3', compact ? '' : 'h-3.5 w-3.5')} />
        </button>
      </div>

      {/* Comment input (shown for both positive and negative) */}
      {pendingRating && (
        <div
          className="flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150"
          data-testid="feedback-comment-form"
        >
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingRating === 'negative' ? 'What went wrong? (optional)' : 'What was good? (optional)'}
            autoFocus
            className={cn(
              'flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs',
              'placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              compact ? 'max-w-[200px]' : 'max-w-[300px]',
            )}
            maxLength={2000}
            data-testid="feedback-comment-input"
          />
          <button
            onClick={handleSubmitFeedback}
            disabled={submitFeedback.isPending}
            className={cn(
              'inline-flex items-center justify-center rounded-md border p-1 transition-colors disabled:opacity-50',
              pendingRating === 'negative'
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
            )}
            aria-label="Submit feedback"
            data-testid="feedback-submit-negative"
          >
            <Send className="h-3 w-3" />
          </button>
          <button
            onClick={handleCancelComment}
            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Cancel"
            data-testid="feedback-cancel"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
