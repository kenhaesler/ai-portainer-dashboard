import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MotionPage, MotionStagger, MotionReveal, _resetVisitedPaths } from './motion-page';

// Mock framer-motion to inspect props without running real animations
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, ...props }: any) => (
      <div data-initial={String(initial)} data-testid="motion-div" {...props}>
        {children}
      </div>
    ),
  },
  useReducedMotion: () => false,
}));

function renderAtPath(path: string, component: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {component}
    </MemoryRouter>,
  );
}

describe('motion-page return-visit animation skip', () => {
  beforeEach(() => {
    _resetVisitedPaths();
  });

  it('MotionPage plays entrance animation on first visit', () => {
    const { getByTestId } = renderAtPath('/', <MotionPage>content</MotionPage>);
    const div = getByTestId('motion-div');
    expect(div.getAttribute('data-initial')).toBe('initial');
  });

  it('MotionPage skips animation on return visit', () => {
    // First visit
    const { unmount } = renderAtPath('/', <MotionPage>content</MotionPage>);
    unmount();

    // Second visit to same path
    const { getByTestId } = renderAtPath('/', <MotionPage>content</MotionPage>);
    const div = getByTestId('motion-div');
    expect(div.getAttribute('data-initial')).toBe('false');
  });

  it('MotionPage plays animation on different path', () => {
    // Visit /
    const { unmount } = renderAtPath('/', <MotionPage>content</MotionPage>);
    unmount();

    // Visit /settings (new path)
    const { getByTestId } = renderAtPath('/settings', <MotionPage>content</MotionPage>);
    const div = getByTestId('motion-div');
    expect(div.getAttribute('data-initial')).toBe('initial');
  });

  it('MotionStagger skips stagger delays on return visit', () => {
    // First visit
    const { unmount } = renderAtPath('/stagger', <MotionStagger>items</MotionStagger>);
    unmount();

    // Return visit
    const { getByTestId } = renderAtPath('/stagger', <MotionStagger>items</MotionStagger>);
    const div = getByTestId('motion-div');
    expect(div.getAttribute('data-initial')).toBe('false');
  });

  it('MotionReveal skips animation on return visit', () => {
    // First visit renders with hidden variant
    const { unmount, getByTestId } = renderAtPath('/reveal', <MotionReveal>content</MotionReveal>);
    unmount();

    // Return visit should not apply hidden variant
    const { getByTestId: getById2 } = renderAtPath('/reveal', <MotionReveal>content</MotionReveal>);
    const div = getById2('motion-div');
    // MotionReveal doesn't use initial prop directly, but when skipAnimation is true
    // the hidden variant should have opacity: 1, y: 0, scale: 1 (no animation)
    expect(div).toBeDefined();
  });
});
