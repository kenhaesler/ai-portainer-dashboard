import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiCard } from './kpi-card';

describe('KpiCard', () => {
  it('should render label and value', () => {
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
    expect(trendElement).toHaveClass('text-emerald-600');
  });

  it('should apply down trend styling', () => {
    render(<KpiCard label="Metric" value={100} trend="down" trendValue="-10" />);

    const trendElement = screen.getByText('-10');
    expect(trendElement).toHaveClass('text-red-600');
  });

  it('should apply neutral trend styling', () => {
    render(<KpiCard label="Metric" value={100} trend="neutral" trendValue="0" />);

    const trendElement = screen.getByText('0');
    expect(trendElement).toHaveClass('text-muted-foreground');
  });

  it('should render icon when provided', () => {
    const TestIcon = () => <span data-testid="test-icon">Icon</span>;
    render(<KpiCard label="With Icon" value={50} icon={<TestIcon />} />);

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <KpiCard label="Custom" value={1} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('should not render trend when not provided', () => {
    render(<KpiCard label="No Trend" value={100} />);

    // The trend container should not be present
    const element = screen.getByText('100');
    expect(element.parentElement?.querySelector('.text-emerald-600')).toBeNull();
    expect(element.parentElement?.querySelector('.text-red-600')).toBeNull();
  });
});
