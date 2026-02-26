import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockMutate = vi.fn();

vi.mock('@/features/ai-intelligence/hooks/use-llm-feedback', () => ({
  useSubmitFeedback: () => ({
    mutate: (...args: unknown[]) => mockMutate(...args),
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { LlmFeedbackButtons } from './llm-feedback-buttons';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('LlmFeedbackButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders thumbs up and thumbs down buttons', () => {
    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('feedback-thumbs-up')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-thumbs-down')).toBeInTheDocument();
  });

  it('shows comment input on thumbs up click', () => {
    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'));

    expect(screen.getByTestId('feedback-comment-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/What was good/)).toBeInTheDocument();
  });

  it('submits positive feedback via comment form', () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="chat_assistant" traceId="tr-123" messageId="msg-1" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'));
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'chat_assistant',
        traceId: 'tr-123',
        messageId: 'msg-1',
        rating: 'positive',
      }),
      expect.any(Object),
    );
  });

  it('shows comment input on thumbs down click', () => {
    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));

    expect(screen.getByTestId('feedback-comment-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/What went wrong/)).toBeInTheDocument();
  });

  it('submits negative feedback with comment', () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="anomaly_explainer" />,
      { wrapper: createWrapper() },
    );

    // Open comment input
    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));

    // Type a comment
    const input = screen.getByTestId('feedback-comment-input');
    fireEvent.change(input, { target: { value: 'Too vague' } });

    // Submit
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'anomaly_explainer',
        rating: 'negative',
        comment: 'Too vague',
      }),
      expect.any(Object),
    );
  });

  it('submits negative feedback without comment', () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'chat_assistant',
        rating: 'negative',
        comment: undefined,
      }),
      expect.any(Object),
    );
  });

  it('cancels comment input', () => {
    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));
    expect(screen.getByTestId('feedback-comment-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('feedback-cancel'));
    expect(screen.queryByTestId('feedback-comment-form')).not.toBeInTheDocument();
  });

  it('shows confirmation after successful positive feedback', async () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'));
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submitted')).toBeInTheDocument();
      expect(screen.getByText('Thanks for your feedback')).toBeInTheDocument();
    });
  });

  it('shows confirmation after successful negative feedback', async () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submitted')).toBeInTheDocument();
    });
  });

  it('disables buttons after submission', async () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'));
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    await waitFor(() => {
      expect(screen.queryByTestId('feedback-buttons')).not.toBeInTheDocument();
    });
  });

  it('renders in compact mode', () => {
    render(
      <LlmFeedbackButtons feature="chat_assistant" compact />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('feedback-buttons')).toBeInTheDocument();
  });

  it('submits via Enter key in comment input', () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));
    const input = screen.getByTestId('feedback-comment-input');
    fireEvent.change(input, { target: { value: 'Not helpful' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 'negative', comment: 'Not helpful' }),
      expect.any(Object),
    );
  });

  it('cancels via Escape key in comment input', () => {
    render(
      <LlmFeedbackButtons feature="chat_assistant" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-down'));
    const input = screen.getByTestId('feedback-comment-input');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByTestId('feedback-comment-form')).not.toBeInTheDocument();
  });

  it('passes responsePreview and userQuery to mutation', () => {
    mockMutate.mockImplementation((params: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    render(
      <LlmFeedbackButtons
        feature="chat_assistant"
        responsePreview="The container is running normally."
        userQuery="Is my container healthy?"
      />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('feedback-thumbs-up'));
    fireEvent.click(screen.getByTestId('feedback-submit-negative'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 'positive',
        responsePreview: 'The container is running normally.',
        userQuery: 'Is my container healthy?',
      }),
      expect.any(Object),
    );
  });
});
