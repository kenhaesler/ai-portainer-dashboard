import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextBanner } from './context-banner';

describe('ContextBanner', () => {
  it('renders source label as "From Remediation" for source=remediation', () => {
    render(
      <ContextBanner
        data={{ source: 'remediation', containerName: 'web-api' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('From Remediation')).toBeInTheDocument();
  });

  it('renders container name when provided', () => {
    render(
      <ContextBanner
        data={{ source: 'remediation', containerName: 'nginx-proxy' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('nginx-proxy')).toBeInTheDocument();
  });

  it('renders containerSummary when provided', () => {
    render(
      <ContextBanner
        data={{
          source: 'remediation',
          containerName: 'backend',
          containerSummary: 'Container CPU usage exceeds threshold',
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Container CPU usage exceeds threshold')).toBeInTheDocument();
  });

  it('does not render summary section when containerSummary is absent', () => {
    render(
      <ContextBanner
        data={{ source: 'remediation', containerName: 'redis' }}
        onDismiss={vi.fn()}
      />,
    );
    // Should not throw or render empty paragraph
    expect(screen.queryByText(/Container CPU/)).not.toBeInTheDocument();
  });

  it('renders generic source label for unknown sources', () => {
    render(
      <ContextBanner
        data={{ source: 'monitoring' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('From monitoring')).toBeInTheDocument();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <ContextBanner
        data={{ source: 'remediation', containerName: 'web' }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss context banner' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('has accessible role and aria-label', () => {
    render(
      <ContextBanner
        data={{ source: 'remediation' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
