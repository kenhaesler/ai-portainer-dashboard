import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks ──────────────────────────────────────────────────────────

const mockFeedbackStats = vi.fn();
const mockRecentNegative = vi.fn();
const mockFeedbackList = vi.fn();
const mockReviewMutate = vi.fn();
const mockBulkDeleteMutate = vi.fn();
const mockGenerateMutate = vi.fn();
const mockSuggestions = vi.fn();
const mockUpdateStatusMutate = vi.fn();

vi.mock('@/hooks/use-llm-feedback', () => ({
  useFeedbackStats: () => ({
    data: mockFeedbackStats(),
    isLoading: false,
  }),
  useRecentNegativeFeedback: () => ({
    data: mockRecentNegative(),
    isLoading: false,
  }),
  useFeedbackList: () => ({
    data: mockFeedbackList(),
    isLoading: false,
  }),
  useReviewFeedback: () => ({
    mutate: (...args: unknown[]) => mockReviewMutate(...args),
    isPending: false,
  }),
  useBulkDeleteFeedback: () => ({
    mutate: (...args: unknown[]) => mockBulkDeleteMutate(...args),
    isPending: false,
  }),
  useGenerateSuggestion: () => ({
    mutate: (...args: unknown[]) => mockGenerateMutate(...args),
    isPending: false,
  }),
  usePromptSuggestions: () => ({
    data: mockSuggestions(),
    isLoading: false,
  }),
  useUpdateSuggestionStatus: () => ({
    mutate: (...args: unknown[]) => mockUpdateStatusMutate(...args),
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  formatDate: (d: string) => d,
}));

import { AiFeedbackPanel } from './settings-ai-feedback';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AiFeedbackPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeedbackStats.mockReturnValue([
      { feature: 'chat_assistant', total: 50, positive: 40, negative: 10, satisfactionRate: 80, pendingCount: 5 },
      { feature: 'anomaly_explainer', total: 20, positive: 12, negative: 8, satisfactionRate: 60, pendingCount: 3 },
    ]);
    mockRecentNegative.mockReturnValue([
      {
        id: 'fb-1',
        feature: 'chat_assistant',
        rating: 'negative',
        comment: 'Response was too generic',
        user_id: 'user-1',
        admin_status: 'pending',
        created_at: '2025-01-15T10:00:00Z',
      },
    ]);
    mockFeedbackList.mockReturnValue({
      items: [
        {
          id: 'fb-1',
          feature: 'chat_assistant',
          rating: 'positive',
          comment: 'Great response!',
          user_id: 'user-1',
          admin_status: 'pending',
          effective_rating: 'positive',
          created_at: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });
    mockSuggestions.mockReturnValue([]);
  });

  it('renders the overview section by default', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('All Feedback')).toBeInTheDocument();
    expect(screen.getByText('Prompt Suggestions')).toBeInTheDocument();
  });

  it('shows KPI cards with stats', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('Total Feedback')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument(); // 50 + 20
    expect(screen.getByText('Positive')).toBeInTheDocument();
    expect(screen.getByText('52')).toBeInTheDocument(); // 40 + 12
    expect(screen.getByText('Negative')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument(); // 10 + 8
  });

  it('shows per-feature statistics', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('Per-Feature Statistics')).toBeInTheDocument();
    expect(screen.getByTestId('feature-stats-table')).toBeInTheDocument();
    // Check satisfaction rates are displayed
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('shows recent negative feedback', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('Recent Negative Feedback')).toBeInTheDocument();
    expect(screen.getByText('Response was too generic')).toBeInTheDocument();
  });

  it('shows empty state when no feedback exists', () => {
    mockFeedbackStats.mockReturnValue([]);
    mockRecentNegative.mockReturnValue([]);

    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('No feedback yet')).toBeInTheDocument();
  });

  it('switches to All Feedback tab', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('All Feedback'));

    // Should show filter controls
    expect(screen.getByTestId('feedback-filters')).toBeInTheDocument();
  });

  it('shows feedback list with filters', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('All Feedback'));

    expect(screen.getByTestId('feedback-list-table')).toBeInTheDocument();
  });

  it('switches to Suggestions tab', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Prompt Suggestions'));

    expect(screen.getByTestId('generate-suggestion-section')).toBeInTheDocument();
    expect(screen.getByText('Generate Prompt Improvement')).toBeInTheDocument();
  });

  it('shows feature select with eligible features', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Prompt Suggestions'));

    const select = screen.getByTestId('suggestion-feature-select');
    expect(select).toBeInTheDocument();
    // chat_assistant has 10 negative => eligible
    expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
  });

  it('shows admin action buttons on pending feedback', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    // Recent negative section shows action buttons for pending
    const approveButtons = screen.getAllByText('Approve');
    expect(approveButtons.length).toBeGreaterThan(0);

    const rejectButtons = screen.getAllByText('Reject');
    expect(rejectButtons.length).toBeGreaterThan(0);
  });

  it('calls review mutation on approve click', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    const approveButtons = screen.getAllByText('Approve');
    fireEvent.click(approveButtons[0]);

    expect(mockReviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fb-1', action: 'approved' }),
    );
  });

  it('shows existing suggestions when available', () => {
    mockSuggestions.mockReturnValue([
      {
        id: 'sug-1',
        feature: 'chat_assistant',
        current_prompt: 'Old prompt',
        suggested_prompt: 'New improved prompt',
        reasoning: 'Users complained about vagueness',
        evidence_feedback_ids: ['fb-1'],
        negative_count: 15,
        status: 'pending',
        applied_at: null,
        applied_by: null,
        created_at: '2025-01-15T12:00:00Z',
      },
    ]);

    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Prompt Suggestions'));

    expect(screen.getByText('Users complained about vagueness')).toBeInTheDocument();
    expect(screen.getByText('Apply Suggestion')).toBeInTheDocument();
    expect(screen.getByText('Edit Before Applying')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('shows empty suggestions state', () => {
    mockSuggestions.mockReturnValue([]);

    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Prompt Suggestions'));

    expect(screen.getByText('No suggestions yet')).toBeInTheDocument();
  });

  it('applies a suggestion', () => {
    mockSuggestions.mockReturnValue([
      {
        id: 'sug-1',
        feature: 'chat_assistant',
        current_prompt: 'Old prompt',
        suggested_prompt: 'New prompt',
        reasoning: 'Improvement needed',
        evidence_feedback_ids: [],
        negative_count: 12,
        status: 'pending',
        applied_at: null,
        applied_by: null,
        created_at: '2025-01-15T12:00:00Z',
      },
    ]);

    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Prompt Suggestions'));
    fireEvent.click(screen.getByText('Apply Suggestion'));

    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sug-1', status: 'applied' }),
    );
  });

  it('dismisses a suggestion', () => {
    mockSuggestions.mockReturnValue([
      {
        id: 'sug-1',
        feature: 'chat_assistant',
        current_prompt: 'Old prompt',
        suggested_prompt: 'New prompt',
        reasoning: 'Improvement needed',
        evidence_feedback_ids: [],
        negative_count: 12,
        status: 'pending',
        applied_at: null,
        applied_by: null,
        created_at: '2025-01-15T12:00:00Z',
      },
    ]);

    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('Prompt Suggestions'));
    fireEvent.click(screen.getByText('Dismiss'));

    expect(mockUpdateStatusMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sug-1', status: 'dismissed' }),
    );
  });
});
