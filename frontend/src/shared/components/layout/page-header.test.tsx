import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders the title as the page h1', () => {
    render(<PageHeader title="Workload Explorer" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Workload Explorer');
    // Exactly one h1 — the reason 11 files wrote their title string twice was
    // that nothing owned this element.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('uses the established desktop title scale and steps down on small viewports', () => {
    render(<PageHeader title="Health" />);
    const heading = screen.getByRole('heading', { level: 1 });
    // text-3xl font-bold tracking-tight is the scale on 17 of 20 pages.
    expect(heading).toHaveClass('sm:text-3xl', 'font-bold', 'tracking-tight');
    // Mobile loses ~370px of fold to title chrome, so the h1 shrinks below sm.
    expect(heading).toHaveClass('text-xl');
  });

  it('omits the subtitle element entirely when no subtitle is given', () => {
    render(<PageHeader title="Health" />);
    expect(screen.queryByTestId('page-header-subtitle')).toBeNull();
  });

  it('renders a muted subtitle when provided', () => {
    render(<PageHeader title="Traces" subtitle="193 traces · 1 service · last 24h" />);
    const subtitle = screen.getByTestId('page-header-subtitle');
    expect(subtitle).toHaveTextContent('193 traces · 1 service · last 24h');
    expect(subtitle).toHaveClass('text-muted-foreground');
  });

  it('accepts a ReactNode subtitle', () => {
    render(<PageHeader title="Fleet" subtitle={<span data-testid="live">13 containers</span>} />);
    expect(screen.getByTestId('live')).toHaveTextContent('13 containers');
  });

  it('hides the subtitle below sm by default', () => {
    render(<PageHeader title="Fleet" subtitle="13 containers across 1 endpoint" />);
    const subtitle = screen.getByTestId('page-header-subtitle');
    expect(subtitle).toHaveClass('hidden', 'sm:block');
  });

  it('keeps the subtitle on mobile when hideSubtitleOnMobile is false', () => {
    render(
      <PageHeader
        title="Fleet"
        subtitle="13 containers across 1 endpoint"
        hideSubtitleOnMobile={false}
      />,
    );
    const subtitle = screen.getByTestId('page-header-subtitle');
    expect(subtitle).not.toHaveClass('hidden');
    expect(subtitle).not.toHaveClass('sm:block');
  });

  it('renders actions on the title row and omits the slot when absent', () => {
    const { rerender } = render(<PageHeader title="Fleet" />);
    expect(screen.queryByTestId('page-header-actions')).toBeNull();

    rerender(<PageHeader title="Fleet" actions={<button type="button">Refresh</button>} />);
    const actions = screen.getByTestId('page-header-actions');
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Refresh' }));
    // Same row as the title, right-aligned by the wrapper's justify-between.
    expect(screen.getByTestId('page-header')).toHaveClass('justify-between');
    expect(screen.getByTestId('page-header')).toContainElement(actions);
  });

  it('has no gradient, icon tile or per-page title escape hatch', () => {
    // The Assistant's h1 drifted into a blue-purple gradient with an icon tile
    // precisely because nothing enforced the shape. There is no prop for it.
    render(<PageHeader title="LLM Assistant" subtitle="anything" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).not.toMatch(/gradient|bg-clip-text|text-transparent/);
    expect(heading.querySelector('svg')).toBeNull();
    expect(heading.children).toHaveLength(0);
  });

  it('merges extra wrapper classes without dropping the layout classes', () => {
    render(<PageHeader title="Fleet" className="mb-6" />);
    const wrapper = screen.getByTestId('page-header');
    expect(wrapper).toHaveClass('mb-6', 'flex', 'justify-between');
  });
});
