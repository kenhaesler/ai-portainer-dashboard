import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageTreemap, getLabelStyleForFill, CustomContent } from './image-treemap';

// ResponsiveContainer requires a measurable parent DOM node (jsdom has no
// layout engine), so we replace it with a simple pass-through wrapper.
vi.mock('recharts', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 400 }}>{children}</div>
    ),
  };
});

/**
 * Helper: renders a CustomContent cell inside an SVG so its
 * SVG-specific attributes (role, tabindex, aria-label) are
 * queryable via testing-library.
 */
function renderCell(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    index: 0,
    name: 'nginx',
    size: 100_000_000,
    onCellClick: vi.fn(),
    ...overrides,
  };
  const result = render(
    <svg>
      <CustomContent {...defaultProps} />
    </svg>,
  );
  return { ...result, props: defaultProps };
}

describe('ImageTreemap', () => {
  it('should show empty state when no data', () => {
    render(<ImageTreemap data={[]} />);
    expect(screen.getByText('No image data')).toBeInTheDocument();
  });

  it('should not show empty state when data is provided', () => {
    const data = [
      { name: 'nginx', size: 100_000_000 },
      { name: 'redis', size: 50_000_000 },
    ];

    render(<ImageTreemap data={data} />);
    expect(screen.queryByText('No image data')).not.toBeInTheDocument();
  });

  it('uses dark text for bright treemap cell colors', () => {
    const style = getLabelStyleForFill('#a5b4fc');
    expect(style.fill).toBe('#0f172a');
  });

  it('uses white text for dark treemap cell colors', () => {
    const style = getLabelStyleForFill('#1e293b');
    expect(style.fill).toBe('#ffffff');
  });

  describe('accessibility', () => {
    const sampleData = [
      { name: 'nginx', size: 100_000_000 },
      { name: 'redis', size: 50_000_000 },
    ];

    it('wraps treemap in a group with aria-label', () => {
      render(<ImageTreemap data={sampleData} />);
      const group = screen.getByRole('group', { name: 'Image size treemap' });
      expect(group).toBeInTheDocument();
    });

    it('renders cell with role="button" and aria-label containing name and size', () => {
      renderCell({ name: 'nginx', size: 100_000_000 });
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button.getAttribute('aria-label')).toBe('nginx, 95.4 MB');
    });

    it('makes cells focusable with tabIndex=0', () => {
      renderCell();
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('tabindex', '0');
    });

    it('triggers onCellClick when Enter is pressed on a focused cell', () => {
      const { props } = renderCell({ name: 'nginx' });
      const button = screen.getByRole('button');

      fireEvent.keyDown(button, { key: 'Enter' });
      expect(props.onCellClick).toHaveBeenCalledWith('nginx');
    });

    it('triggers onCellClick when Space is pressed on a focused cell', () => {
      const { props } = renderCell({ name: 'redis', size: 50_000_000 });
      const button = screen.getByRole('button');

      fireEvent.keyDown(button, { key: ' ' });
      expect(props.onCellClick).toHaveBeenCalledWith('redis');
    });

    it('triggers onCellClick when a cell is clicked', () => {
      const { props } = renderCell({ name: 'nginx' });
      const button = screen.getByRole('button');

      fireEvent.click(button);
      expect(props.onCellClick).toHaveBeenCalledWith('nginx');
    });

    it('does not call onCellClick for unrelated keys', () => {
      const { props } = renderCell();
      const button = screen.getByRole('button');

      fireEvent.keyDown(button, { key: 'Tab' });
      fireEvent.keyDown(button, { key: 'Escape' });
      expect(props.onCellClick).not.toHaveBeenCalled();
    });

    it('does not set aria-label when name is undefined', () => {
      renderCell({ name: undefined });
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toBeNull();
    });
  });
});
