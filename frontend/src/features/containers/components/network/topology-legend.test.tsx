import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopologyLegend } from './topology-legend';

describe('TopologyLegend', () => {
  it('renders toggle button', () => {
    render(<TopologyLegend />);
    expect(screen.getByRole('button', { name: /legend/i })).toBeTruthy();
  });

  it('positions clear of the diagram controls (offset right and down)', () => {
    // The React Flow zoom controls sit in the bottom-left corner; the legend
    // must be offset right and toward the bottom so it does not overlap them.
    const { container } = render(<TopologyLegend />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('absolute');
    expect(wrapper.className).toContain('left-16');
    expect(wrapper.className).toContain('bottom-4');
    // Guard against regressing onto the controls' bottom-left position.
    expect(wrapper.className).not.toContain('left-3');
    expect(wrapper.className).not.toContain('bottom-14');
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
