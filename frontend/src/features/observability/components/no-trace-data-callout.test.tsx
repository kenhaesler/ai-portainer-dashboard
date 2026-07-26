import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NoTraceDataCallout } from './no-trace-data-callout';

describe('NoTraceDataCallout', () => {
  it('renders the headline copy', () => {
    render(
      <MemoryRouter>
        <NoTraceDataCallout />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no trace data/i)).toBeInTheDocument();
  });

  it('renders the Beyla CTA link pointing at the eBPF coverage page', () => {
    render(
      <MemoryRouter>
        <NoTraceDataCallout />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /beyla|ebpf|deploy/i });
    expect(link).toHaveAttribute('href', '/ebpf-coverage');
  });

  it('honours an optional custom description', () => {
    render(
      <MemoryRouter>
        <NoTraceDataCallout description="Custom hint text" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Custom hint text')).toBeInTheDocument();
  });

  // The callout used raw purple (`border-purple-400/30`, `bg-purple-500/5`,
  // `text-purple-500`) which assumes a dark surface across 16 themes, 8 of them
  // light — and purple is this design system's reserved AI-insight colour,
  // which a trace empty state is not.
  it('uses theme tokens rather than raw palette colours', () => {
    const { container } = render(
      <MemoryRouter>
        <NoTraceDataCallout />
      </MemoryRouter>,
    );
    expect(container.innerHTML).not.toMatch(/purple-/);
    const card = screen.getByTestId('no-trace-data-callout');
    expect(card.className).toContain('border-border');
  });

  // Regression: the CTA was the only solid-fill button on /llm-observability,
  // making a docs jump the loudest element on a page of real telemetry.
  it('renders the Beyla CTA as a text link, not a solid-fill button', () => {
    render(
      <MemoryRouter>
        <NoTraceDataCallout />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /deploy beyla/i });
    expect(link.className).not.toMatch(/bg-(purple|primary|blue)-?\d*/);
    expect(link.className).toContain('text-primary');
  });
});
