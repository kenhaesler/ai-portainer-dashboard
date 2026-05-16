import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SkeletonText,
  SkeletonKpi,
  SkeletonTableRow,
  SkeletonChart,
  SkeletonList,
} from './skeleton';

describe('SkeletonText', () => {
  it('renders the default number of lines (3)', () => {
    const { container } = render(<SkeletonText />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders the requested number of lines', () => {
    const { container } = render(<SkeletonText lines={6} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
  });

  it('marks the last line narrower than the others', () => {
    const { container } = render(<SkeletonText lines={4} />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines[lines.length - 1]).toHaveClass('w-2/3');
  });

  it('exposes a status role with a loading label', () => {
    render(<SkeletonText />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('applies a custom className to the wrapper', () => {
    const { container } = render(<SkeletonText className="mt-4" />);
    expect(container.firstChild).toHaveClass('mt-4');
  });
});

describe('SkeletonKpi', () => {
  it('renders three stacked bars (label, big number, sublabel)', () => {
    const { container } = render(<SkeletonKpi />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders the big number bar taller than the label bar', () => {
    const { container } = render(<SkeletonKpi />);
    const bars = container.querySelectorAll('.animate-pulse');
    expect(bars[1]).toHaveClass('h-8');
    expect(bars[0]).toHaveClass('h-3');
  });

  it('exposes status role with loading label', () => {
    render(<SkeletonKpi />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('applies a custom className', () => {
    const { container } = render(<SkeletonKpi className="h-full" />);
    expect(container.firstChild).toHaveClass('h-full');
  });
});

describe('SkeletonTableRow', () => {
  it('renders the requested number of cells', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow columns={5} />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('tr > td')).toHaveLength(5);
  });

  it('puts a pulsing bar inside each cell', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow columns={3} />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('td > .animate-pulse')).toHaveLength(3);
  });

  it('defaults to 4 columns when no count is provided', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('td')).toHaveLength(4);
  });
});

describe('SkeletonChart', () => {
  it('renders a single pulsing block', () => {
    const { container } = render(<SkeletonChart />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
  });

  it('defaults to medium height (h-48)', () => {
    const { container } = render(<SkeletonChart />);
    expect(container.firstChild).toHaveClass('h-48');
  });

  it('uses h-80 for large size', () => {
    const { container } = render(<SkeletonChart size="lg" />);
    expect(container.firstChild).toHaveClass('h-80');
  });

  it('exposes status role with loading label', () => {
    render(<SkeletonChart />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('applies a custom className', () => {
    const { container } = render(<SkeletonChart className="mt-2" />);
    expect(container.firstChild).toHaveClass('mt-2');
  });
});

describe('SkeletonList', () => {
  it('renders the default number of rows (4)', () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(4);
  });

  it('renders the requested number of rows', () => {
    const { container } = render(<SkeletonList rows={7} />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(7);
  });

  it('renders an avatar circle plus two text bars per row', () => {
    const { container } = render(<SkeletonList rows={1} />);
    const row = container.querySelector('[data-skeleton-row]');
    expect(row?.querySelector('.rounded-full')).toBeInTheDocument();
    expect(row?.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('exposes a status role with loading label', () => {
    render(<SkeletonList />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });
});
