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
