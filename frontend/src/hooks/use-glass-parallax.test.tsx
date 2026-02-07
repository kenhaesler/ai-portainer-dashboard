import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useGlassParallax } from '@/hooks/use-glass-parallax';

function TestHarness({ enabled }: { enabled: boolean }) {
  useGlassParallax(enabled);
  return null;
}

describe('useGlassParallax', () => {
  const originalMatchMedia = window.matchMedia;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true,
    });

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    document.documentElement.style.removeProperty('--glass-bg-shift-x');
    document.documentElement.style.removeProperty('--glass-bg-shift-y');
    document.documentElement.style.removeProperty('--glass-card-shift-x');
    document.documentElement.style.removeProperty('--glass-card-shift-y');
  });

  it('sets parallax CSS variables when enabled', () => {
    render(<TestHarness enabled />);

    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 100, clientY: 200 })
    );

    const rootStyle = document.documentElement.style;
    expect(rootStyle.getPropertyValue('--glass-bg-shift-x')).not.toBe('0px');
    expect(rootStyle.getPropertyValue('--glass-bg-shift-y')).not.toBe('0px');
    expect(rootStyle.getPropertyValue('--glass-card-shift-x')).not.toBe('0px');
    expect(rootStyle.getPropertyValue('--glass-card-shift-y')).not.toBe('0px');
  });

  it('resets parallax variables when disabled', () => {
    const { rerender } = render(<TestHarness enabled />);

    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 100, clientY: 200 })
    );

    rerender(<TestHarness enabled={false} />);

    const rootStyle = document.documentElement.style;
    expect(rootStyle.getPropertyValue('--glass-bg-shift-x')).toBe('0px');
    expect(rootStyle.getPropertyValue('--glass-bg-shift-y')).toBe('0px');
    expect(rootStyle.getPropertyValue('--glass-card-shift-x')).toBe('0px');
    expect(rootStyle.getPropertyValue('--glass-card-shift-y')).toBe('0px');
  });
});
