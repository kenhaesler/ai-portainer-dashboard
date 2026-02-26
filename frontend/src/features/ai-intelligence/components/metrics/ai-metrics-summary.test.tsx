import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiMetricsSummary } from './ai-metrics-summary';

// Mock the hook
vi.mock('@/features/ai-intelligence/hooks/use-ai-metrics-summary', () => ({
  useAiMetricsSummary: vi.fn(),
}));

import { useAiMetricsSummary } from '@/features/ai-intelligence/hooks/use-ai-metrics-summary';
const mockUseAiMetricsSummary = vi.mocked(useAiMetricsSummary);

describe('AiMetricsSummary', () => {
  const defaultProps = {
    endpointId: 1,
    containerId: 'container-abc',
    timeRange: '1h',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render nothing when no container is selected', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: '',
      isStreaming: false,
      error: null,
      refresh: vi.fn(),
    });

    const { container } = render(
      <AiMetricsSummary endpointId={undefined} containerId={undefined} timeRange="1h" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('should render nothing when LLM is unavailable', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: '',
      isStreaming: false,
      error: 'unavailable',
      refresh: vi.fn(),
    });

    const { container } = render(<AiMetricsSummary {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('should show loading skeleton while streaming with no text', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: '',
      isStreaming: true,
      error: null,
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary {...defaultProps} />);

    expect(screen.getByText('AI Summary')).toBeInTheDocument();
    // Should show pulse skeleton divs
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should display streamed summary text', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: 'CPU usage is stable at 2%.',
      isStreaming: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary {...defaultProps} />);

    expect(screen.getByText('CPU usage is stable at 2%.')).toBeInTheDocument();
  });

  it('should show typing cursor while streaming with text', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: 'CPU usage is',
      isStreaming: true,
      error: null,
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary {...defaultProps} />);

    expect(screen.getByText(/CPU usage is/)).toBeInTheDocument();
    // Typing cursor should be visible (animate-pulse span)
    const cursor = document.querySelector('.bg-purple-500.animate-pulse');
    expect(cursor).toBeInTheDocument();
  });

  it('should show error state for non-unavailable errors', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: '',
      isStreaming: false,
      error: 'Failed to generate summary',
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary {...defaultProps} />);

    expect(screen.getByText('AI summary unavailable right now')).toBeInTheDocument();
  });

  it('should have a refresh button', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: 'All good.',
      isStreaming: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary {...defaultProps} />);

    const refreshButton = screen.getByTitle('Regenerate summary');
    expect(refreshButton).toBeInTheDocument();
  });

  it('should disable refresh button while streaming', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: 'Loading...',
      isStreaming: true,
      error: null,
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary {...defaultProps} />);

    const refreshButton = screen.getByTitle('Regenerate summary');
    expect(refreshButton).toBeDisabled();
  });

  it('should pass correct props to the hook', () => {
    mockUseAiMetricsSummary.mockReturnValue({
      summary: '',
      isStreaming: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<AiMetricsSummary endpointId={3} containerId="my-container" timeRange="24h" />);

    expect(mockUseAiMetricsSummary).toHaveBeenCalledWith(3, 'my-container', '24h');
  });
});
