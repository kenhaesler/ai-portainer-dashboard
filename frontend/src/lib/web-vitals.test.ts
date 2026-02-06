import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOnCLS = vi.fn();
const mockOnINP = vi.fn();
const mockOnLCP = vi.fn();
const mockOnTTFB = vi.fn();

vi.mock('web-vitals', () => ({
  onCLS: (...args: unknown[]) => mockOnCLS(...args),
  onINP: (...args: unknown[]) => mockOnINP(...args),
  onLCP: (...args: unknown[]) => mockOnLCP(...args),
  onTTFB: (...args: unknown[]) => mockOnTTFB(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reportWebVitals', () => {
  it('registers all four web vital handlers', async () => {
    const { reportWebVitals } = await import('./web-vitals');
    const handler = vi.fn();
    await reportWebVitals(handler);

    expect(mockOnCLS).toHaveBeenCalledWith(handler);
    expect(mockOnINP).toHaveBeenCalledWith(handler);
    expect(mockOnLCP).toHaveBeenCalledWith(handler);
    expect(mockOnTTFB).toHaveBeenCalledWith(handler);
  });

  it('uses default handler when no callback provided', async () => {
    const { reportWebVitals } = await import('./web-vitals');
    await reportWebVitals();

    expect(mockOnCLS).toHaveBeenCalledWith(expect.any(Function));
    expect(mockOnINP).toHaveBeenCalledWith(expect.any(Function));
    expect(mockOnLCP).toHaveBeenCalledWith(expect.any(Function));
    expect(mockOnTTFB).toHaveBeenCalledWith(expect.any(Function));
  });

  it('default handler logs metric in dev mode', async () => {
    const { reportWebVitals } = await import('./web-vitals');
    await reportWebVitals();

    // Get the handler that was passed to onCLS
    const handler = mockOnCLS.mock.calls[0][0];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    handler({ name: 'CLS', value: 0.05, rating: 'good' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Web Vitals] CLS: 0.05 (good)'),
    );

    consoleSpy.mockRestore();
  });
});
