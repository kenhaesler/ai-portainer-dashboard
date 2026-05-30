import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiInsightCard } from './ai-insight-card';

// Stub matchMedia to avoid errors
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('AiInsightCard', () => {
  beforeEach(() => {
    stubMatchMedia();
  });

  it('renders with default "AI INSIGHT" label', () => {
    render(
      <AiInsightCard>
        <p>Some insight text</p>
      </AiInsightCard>,
    );

    // The default title is "AI Insight" rendered in uppercase via CSS
    expect(screen.getByText('AI Insight')).toBeInTheDocument();
    expect(screen.getByText('Some insight text')).toBeInTheDocument();
  });

  it('renders with custom title', () => {
    render(
      <AiInsightCard title="Custom Title">
        <p>Content</p>
      </AiInsightCard>,
    );

    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });

  it('shows cursor when streaming', () => {
    render(
      <AiInsightCard streaming>
        <p>Streaming content</p>
      </AiInsightCard>,
    );

    expect(screen.getByTestId('ai-insight-cursor')).toBeInTheDocument();
  });

  it('does not show cursor when not streaming', () => {
    render(
      <AiInsightCard>
        <p>Static content</p>
      </AiInsightCard>,
    );

    expect(screen.queryByTestId('ai-insight-cursor')).not.toBeInTheDocument();
  });

  it('shows confidence bar when confidence prop provided', () => {
    render(
      <AiInsightCard confidence={85}>
        <p>High confidence</p>
      </AiInsightCard>,
    );

    const bar = screen.getByTestId('ai-insight-confidence');
    expect(bar).toBeInTheDocument();
    const fill = bar.firstChild as HTMLElement;
    expect(fill.style.width).toBe('85%');
  });

  it('does not show confidence bar when confidence not provided', () => {
    render(
      <AiInsightCard>
        <p>No confidence</p>
      </AiInsightCard>,
    );

    expect(screen.queryByTestId('ai-insight-confidence')).not.toBeInTheDocument();
  });

  it('shows shimmer overlay when streaming', () => {
    render(
      <AiInsightCard streaming>
        <p>Streaming</p>
      </AiInsightCard>,
    );

    expect(screen.getByTestId('ai-insight-shimmer')).toBeInTheDocument();
  });

  it('hides shimmer when not streaming', () => {
    render(
      <AiInsightCard>
        <p>Not streaming</p>
      </AiInsightCard>,
    );

    expect(screen.queryByTestId('ai-insight-shimmer')).not.toBeInTheDocument();
  });
});
