import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MotionPage, MotionReveal, MotionStagger } from './motion-page';

describe('motion-page utilities', () => {
  it('renders page wrapper children', () => {
    render(
      <MotionPage>
        <div>Page Content</div>
      </MotionPage>,
    );

    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('renders reveal and stagger wrappers', () => {
    render(
      <MotionStagger>
        <MotionReveal>
          <div>Reveal Content</div>
        </MotionReveal>
      </MotionStagger>,
    );

    expect(screen.getByText('Reveal Content')).toBeInTheDocument();
  });

  it('applies space-y-6 class by default', () => {
    const { container } = render(
      <MotionPage>
        <div>Content</div>
      </MotionPage>,
    );
    expect(container.firstChild).toHaveClass('space-y-6');
  });

  it('accepts custom className', () => {
    const { container } = render(
      <MotionPage className="custom-class">
        <div>Content</div>
      </MotionPage>,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
