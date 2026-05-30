import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataFreshness } from './data-freshness';

describe('DataFreshness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render nothing when lastUpdated is null', () => {
    const { container } = render(<DataFreshness lastUpdated={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('should show "Just now" for very recent updates', () => {
    render(<DataFreshness lastUpdated={Date.now()} />);
    expect(screen.getByText(/Just now/)).toBeInTheDocument();
  });

  it('should show seconds for updates < 60s old', () => {
    const tenSecondsAgo = Date.now() - 10_000;
    render(<DataFreshness lastUpdated={tenSecondsAgo} />);
    expect(screen.getByText(/10s ago/)).toBeInTheDocument();
  });

  it('should show minutes for updates > 60s old', () => {
    const twoMinutesAgo = Date.now() - 120_000;
    render(<DataFreshness lastUpdated={twoMinutesAgo} />);
    expect(screen.getByText(/2m ago/)).toBeInTheDocument();
  });

  it('should accept ISO string timestamps', () => {
    const recentIso = new Date(Date.now() - 5000).toISOString();
    render(<DataFreshness lastUpdated={recentIso} />);
    expect(screen.getByText(/5s ago/)).toBeInTheDocument();
  });

  it('should apply green color for fresh data (<10s)', () => {
    const { container } = render(<DataFreshness lastUpdated={Date.now()} />);
    const button = container.querySelector('button');
    expect(button).toHaveClass('text-emerald-600');
  });

  it('should apply amber color for aging data (30-60s)', () => {
    const fortySecondsAgo = Date.now() - 40_000;
    const { container } = render(<DataFreshness lastUpdated={fortySecondsAgo} />);
    const button = container.querySelector('button');
    expect(button).toHaveClass('text-amber-600');
  });

  it('should apply red color for stale data (>60s)', () => {
    const twoMinutesAgo = Date.now() - 120_000;
    const { container } = render(<DataFreshness lastUpdated={twoMinutesAgo} />);
    const button = container.querySelector('button');
    expect(button).toHaveClass('text-red-600');
  });

  it('should call onRefresh when clicked', () => {
    const onRefresh = vi.fn();
    render(<DataFreshness lastUpdated={Date.now()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText(/Just now/));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('should be disabled without onRefresh callback', () => {
    const { container } = render(<DataFreshness lastUpdated={Date.now()} />);
    const button = container.querySelector('button');
    expect(button).toBeDisabled();
  });
});
