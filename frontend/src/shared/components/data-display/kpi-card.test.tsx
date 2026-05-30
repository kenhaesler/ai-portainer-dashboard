import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiCard } from './kpi-card';

// Stub matchMedia so useReducedMotion and useCountUp work in tests.
// We set prefers-reduced-motion: reduce to true so animations are instant.
function stubMatchMedia(reduce = true) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
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

describe('KpiCard', () => {
  beforeEach(() => {
    stubMatchMedia(true); // Reduced motion = instant values
  });

  it('should render label and numeric value', () => {
    render(<KpiCard label="Total Containers" value={42} />);

    expect(screen.getByText('Total Containers')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('should render string values', () => {
    render(<KpiCard label="Status" value="Healthy" />);

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('should render trend indicator when provided', () => {
    render(<KpiCard label="CPU Usage" value="45%" trend="up" trendValue="+5%" />);

    expect(screen.getByText('+5%')).toBeInTheDocument();
  });

  it('should apply up trend styling', () => {
    render(<KpiCard label="Metric" value={100} trend="up" trendValue="+10" />);

    const trendElement = screen.getByText('+10');
    expect(trendElement.closest('span')).toHaveClass('text-emerald-600');
  });

  it('should apply down trend styling', () => {
    render(<KpiCard label="Metric" value={100} trend="down" trendValue="-10" />);

    const trendElement = screen.getByText('-10');
    expect(trendElement.closest('span')).toHaveClass('text-red-600');
  });

  it('should apply neutral trend styling', () => {
    render(<KpiCard label="Metric" value={100} trend="neutral" trendValue="0" />);

    const trendElement = screen.getByText('0');
    expect(trendElement.closest('span')).toHaveClass('text-muted-foreground');
  });

  it('should render icon when provided', () => {
    const TestIcon = () => <span data-testid="test-icon">Icon</span>;
    render(<KpiCard label="With Icon" value={50} icon={<TestIcon />} />);

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <KpiCard label="Custom" value={1} className="custom-class" />,
    );

    // The SpotlightCard wrapper is container.firstChild; the inner card div has the className
    const innerCard = container.querySelector('.custom-class');
    expect(innerCard).toBeInTheDocument();
  });

  it('should not render trend when not provided', () => {
    render(<KpiCard label="No Trend" value={100} />);

    const element = screen.getByText('100');
    expect(element.parentElement?.querySelector('.text-emerald-600')).toBeNull();
    expect(element.parentElement?.querySelector('.text-red-600')).toBeNull();
  });

  // New tests for sparkline, hover detail, and pulse
  it('should render sparkline when sparklineData is provided', () => {
    const { container } = render(
      <KpiCard
        label="Running"
        value={15}
        sparklineData={[10, 12, 14, 15]}
      />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should not render sparkline when sparklineData has fewer than 2 points', () => {
    const { container } = render(
      <KpiCard label="Running" value={15} sparklineData={[10]} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('should show detail information when hoverDetail is provided', () => {
    render(
      <KpiCard
        label="Running"
        value={15}
        hoverDetail="Last hour: +3 | Peak: 20 | Avg: 14"
      />,
    );

    // Detail text should be visible immediately (no hover required)
    const detail = screen.getByText('Last hour: +3 | Peak: 20 | Avg: 14');
    expect(detail).toBeInTheDocument();
    expect(detail.parentElement).toHaveClass('mt-2');
  });

  it('should not render hover detail section when hoverDetail is not provided', () => {
    render(<KpiCard label="Running" value={15} />);

    // There should be no detail expansion element
    const detailElements = document.querySelectorAll('.text-xs.text-muted-foreground');
    // Only trend-value text might exist, but not hover detail
    const hoverDetailTexts = Array.from(detailElements).filter(
      (el) => el.textContent?.includes('Last hour'),
    );
    expect(hoverDetailTexts).toHaveLength(0);
  });

  describe('disableHoverLift', () => {
    // Stub matchMedia with reduce=false so the `!potatoMode` hover utilities
    // are actually applied. Under reduce=true the underlying CSS classes are
    // still attached (Tailwind classes don't react to matchMedia), but being
    // explicit guards against future changes that gate them on motion prefs.
    beforeEach(() => stubMatchMedia(false));

    it('applies hover:-translate-y-0.5 by default', () => {
      const { container } = render(<KpiCard label="Default lift" value={1} />);

      // The inner card div is the one carrying hover utilities.
      const innerCard = container.querySelector(
        '.rounded-lg.border.bg-card',
      ) as HTMLElement | null;
      expect(innerCard).not.toBeNull();
      expect(innerCard!.className).toContain('hover:-translate-y-0.5');
    });

    it('drops hover:-translate-y-0.5 when disableHoverLift is set', () => {
      const { container } = render(
        <KpiCard label="No lift" value={1} disableHoverLift />,
      );

      const innerCard = container.querySelector(
        '.rounded-lg.border.bg-card',
      ) as HTMLElement | null;
      expect(innerCard).not.toBeNull();
      expect(innerCard!.className).not.toContain('hover:-translate-y-0.5');
      // Other hover affordances are preserved so the card still feels alive.
      expect(innerCard!.className).toContain('hover:shadow-md');
      expect(innerCard!.className).toContain('hover:border-primary/20');
    });
  });
});
