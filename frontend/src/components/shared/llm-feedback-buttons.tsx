import { useState, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Send, X } from 'lucide-react';
import { useSubmitFeedback } from '@/hooks/use-llm-feedback';
import { cn } from '@/lib/utils';

interface LlmFeedbackButtonsProps {
  /** The LLM feature that generated this output */
  feature: string;
  /** Optional trace ID linking to llm_traces table */
  traceId?: string;
  /** Message ID for chat messages */
  messageId?: string;
  /** Compact mode for inline displays */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function LlmFeedbackButtons({
  feature,
  traceId,
  messageId,
  compact = false,
  className,
}: LlmFeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<'positive' | 'negative' | null>(null);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState('');
  const submitFeedback = useSubmitFeedback();

  const handleThumbsUp = useCallback(() => {
    if (submitted) return;
    submitFeedback.mutate(
      { feature, traceId, messageId, rating: 'positive' },
      { onSuccess: () => setSubmitted('positive') },
    );
  }, [submitted, feature, traceId, messageId, submitFeedback]);

  const handleThumbsDown = useCallback(() => {
    if (submitted) return;
    setShowCommentInput(true);
  }, [submitted]);

  const handleSubmitNegative = useCallback(() => {
    submitFeedback.mutate(
      { feature, traceId, messageId, rating: 'negative', comment: comment.trim() || undefined },
      {
        onSuccess: () => {
          setSubmitted('negative');
          setShowCommentInput(false);
          setComment('');
        },
      },
    );
  }, [feature, traceId, messageId, comment, submitFeedback]);

  const handleCancelComment = useCallback(() => {
    setShowCommentInput(false);
    setComment('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitNegative();
    }
    if (e.key === 'Escape') {
      handleCancelComment();
    }
  }, [handleSubmitNegative, handleCancelComment]);

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
          onClick={handleThumbsUp}
          disabled={submitFeedback.isPending}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors',
            'hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          aria-label="Good response"
          title="Good response"
          data-testid="feedback-thumbs-up"
        >
          <ThumbsUp className={cn('h-3 w-3', compact ? '' : 'h-3.5 w-3.5')} />
        </button>
        <button
          onClick={handleThumbsDown}
          disabled={submitFeedback.isPending}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors',
            'hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          aria-label="Poor response"
          title="Poor response"
          data-testid="feedback-thumbs-down"
        >
          <ThumbsDown className={cn('h-3 w-3', compact ? '' : 'h-3.5 w-3.5')} />
        </button>
      </div>

      {/* Comment input for negative feedback */}
      {showCommentInput && (
        <div
          className="flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150"
          data-testid="feedback-comment-form"
        >
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What went wrong? (optional)"
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
            onClick={handleSubmitNegative}
            disabled={submitFeedback.isPending}
            className="inline-flex items-center justify-center rounded-md bg-amber-500/10 border border-amber-500/20 p-1 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
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
