import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity, AlertTriangle, Settings } from 'lucide-react';
import { EmptyState } from './empty-state';

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: { potatoMode: boolean }) => boolean) =>
    selector({ potatoMode: false }),
}));

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState icon={Activity} title="No traces yet" />);
    expect(screen.getByText('No traces yet')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <EmptyState
        icon={Activity}
        title="No traces yet"
        description="Run a workload to start capturing distributed traces."
      />,
    );
    expect(
      screen.getByText('Run a workload to start capturing distributed traces.'),
    ).toBeInTheDocument();
  });

  it('omits description paragraph when not provided', () => {
    const { container } = render(<EmptyState icon={Activity} title="Empty" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('uses neutral muted tint for default (empty) variant', () => {
    const { container } = render(<EmptyState icon={Activity} title="t" />);
    const iconEl = container.querySelector('svg');
    expect(iconEl).toHaveClass('text-muted-foreground');
  });

  it('uses destructive tint for error variant', () => {
    const { container } = render(
      <EmptyState variant="error" icon={AlertTriangle} title="Failed" />,
    );
    const iconEl = container.querySelector('svg');
    expect(iconEl).toHaveClass('text-destructive/80');
  });

  it('uses amber tint for not-configured variant', () => {
    const { container } = render(
      <EmptyState variant="not-configured" icon={Settings} title="Not set up" />,
    );
    const iconEl = container.querySelector('svg');
    expect(iconEl).toHaveClass('text-amber-500/80');
  });

  it('renders the canonical pane chrome (border + bg-card + shadow-sm + rounded-lg)', () => {
    render(<EmptyState icon={Activity} title="t" />);
    const card = screen.getByTestId('empty-state-card');
    expect(card).toHaveClass('rounded-lg', 'border', 'bg-card', 'shadow-sm');
  });

  it('applies a custom className to the inner card', () => {
    render(<EmptyState icon={Activity} title="t" className="h-64" />);
    expect(screen.getByTestId('empty-state-card')).toHaveClass('h-64');
  });

  it('renders a circular icon chip around the icon', () => {
    const { container } = render(<EmptyState icon={Activity} title="t" />);
    const chip = container.querySelector('.rounded-full');
    expect(chip).toBeInTheDocument();
    expect(chip?.querySelector('svg')).toBeInTheDocument();
  });
});
