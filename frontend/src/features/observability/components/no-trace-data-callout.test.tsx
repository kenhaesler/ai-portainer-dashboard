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
});
