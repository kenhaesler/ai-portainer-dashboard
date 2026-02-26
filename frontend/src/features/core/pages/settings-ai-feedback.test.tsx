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

vi.mock('@/features/ai-intelligence/hooks/use-llm-feedback', () => ({
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

vi.mock('@/shared/lib/utils', () => ({
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
        username: 'alice',
        admin_status: 'pending',
        response_preview: 'The container is running fine.',
        user_query: 'Is my app down?',
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
          username: 'alice',
          admin_status: 'pending',
          effective_rating: 'positive',
          response_preview: 'Here are your containers...',
          user_query: 'Show me my containers',
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

  it('shows recent negative feedback with username', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('Recent Negative Feedback')).toBeInTheDocument();
    expect(screen.getByText('Response was too generic')).toBeInTheDocument();
    expect(screen.getByText('by alice')).toBeInTheDocument();
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

  it('shows admin action buttons on pending feedback in overview', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    // Recent negative section shows action buttons for pending
    const approveButtons = screen.getAllByText('Approve');
    expect(approveButtons.length).toBeGreaterThan(0);

    const rejectButtons = screen.getAllByText('Reject');
    expect(rejectButtons.length).toBeGreaterThan(0);
  });

  it('shows admin note form when clicking Approve in overview', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    const approveButtons = screen.getAllByText('Approve');
    fireEvent.click(approveButtons[0]);

    expect(screen.getByTestId('admin-note-form')).toBeInTheDocument();
    expect(screen.getByTestId('admin-note-input')).toBeInTheDocument();
  });

  it('submits review with admin note from overview', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    const approveButtons = screen.getAllByText('Approve');
    fireEvent.click(approveButtons[0]);

    const noteInput = screen.getByTestId('admin-note-input');
    fireEvent.change(noteInput, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByTestId('admin-note-confirm'));

    expect(mockReviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fb-1', action: 'approved', note: 'Looks good' }),
      expect.any(Object),
    );
  });

  it('shows context toggle for negative feedback with response data', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    expect(screen.getByTestId('toggle-context')).toBeInTheDocument();
  });

  it('shows context when toggled', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByTestId('toggle-context'));

    expect(screen.getByTestId('feedback-context')).toBeInTheDocument();
    expect(screen.getByText('Is my app down?')).toBeInTheDocument();
    expect(screen.getByText('The container is running fine.')).toBeInTheDocument();
  });

  it('shows username in expanded feedback row', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('All Feedback'));

    // Expand the first row
    const expandButtons = screen.getAllByRole('button');
    const chevronButton = expandButtons.find(b => b.querySelector('svg'));
    if (chevronButton) fireEvent.click(chevronButton);

    // The expanded section should show username
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it('shows admin note input when clicking action in expanded feedback row', () => {
    render(<AiFeedbackPanel />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText('All Feedback'));

    // Expand the first row by clicking the chevron
    const expandButtons = screen.getAllByRole('button');
    const chevronButton = expandButtons.find(b => b.querySelector('svg'));
    if (chevronButton) fireEvent.click(chevronButton);

    // Click Approve in the expanded row
    const approveButton = screen.getByText('Approve');
    fireEvent.click(approveButton);

    // Should show admin note form
    expect(screen.getByTestId('admin-note-form')).toBeInTheDocument();
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
