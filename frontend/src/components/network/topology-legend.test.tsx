import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopologyLegend } from './topology-legend';

describe('TopologyLegend', () => {
  it('renders toggle button', () => {
    render(<TopologyLegend />);
    expect(screen.getByRole('button', { name: /legend/i })).toBeTruthy();
  });

  it('hides legend entries by default', () => {
    render(<TopologyLegend />);
    expect(screen.queryByText('Edge Load')).toBeNull();
  });

  it('shows all 5 color tiers when opened', () => {
    render(<TopologyLegend />);
    fireEvent.click(screen.getByRole('button', { name: /legend/i }));

    expect(screen.getByText('Edge Load')).toBeTruthy();
    expect(screen.getByText('No data / Idle')).toBeTruthy();
    expect(screen.getByText('Low (< 10 KB/s)')).toBeTruthy();
    expect(screen.getByText(/Medium/)).toBeTruthy();
    expect(screen.getByText(/High \(100/)).toBeTruthy();
    expect(screen.getByText(/Very High/)).toBeTruthy();
  });

  it('hides entries when toggled closed', () => {
    render(<TopologyLegend />);
    const btn = screen.getByRole('button', { name: /legend/i });

    fireEvent.click(btn); // open
    expect(screen.getByText('Edge Load')).toBeTruthy();

    fireEvent.click(btn); // close
    expect(screen.queryByText('Edge Load')).toBeNull();
  });
});
