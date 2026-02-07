import { describe, it, expect } from 'vitest';
import { getEdgeStyle } from './topology-graph';

describe('getEdgeStyle', () => {
  it('returns gray/thin for stopped containers', () => {
    const rates = { c1: { rxBytesPerSec: 500_000, txBytesPerSec: 500_000 } };
    const style = getEdgeStyle('c1', 'stopped', rates);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns gray/thin when no rates data', () => {
    const style = getEdgeStyle('c1', 'running', undefined);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns gray/thin when container has no rate entry', () => {
    const rates = { other: { rxBytesPerSec: 1000, txBytesPerSec: 1000 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns gray/thin for zero traffic', () => {
    const rates = { c1: { rxBytesPerSec: 0, txBytesPerSec: 0 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#6b7280');
    expect(style.strokeWidth).toBe(1.5);
  });

  it('returns green for low traffic (< 10 KB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 3000, txBytesPerSec: 2000 } }; // 5 KB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#10b981');
    expect(style.strokeWidth).toBe(2);
  });

  it('returns yellow for medium traffic (< 100 KB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 30_000, txBytesPerSec: 20_000 } }; // 50 KB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#eab308');
    expect(style.strokeWidth).toBe(3);
  });

  it('returns orange for high traffic (< 1 MB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 300_000, txBytesPerSec: 200_000 } }; // 500 KB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#f97316');
    expect(style.strokeWidth).toBe(4);
  });

  it('returns red for very high traffic (>= 1 MB/s)', () => {
    const rates = { c1: { rxBytesPerSec: 600_000, txBytesPerSec: 600_000 } }; // 1.2 MB/s total
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#ef4444');
    expect(style.strokeWidth).toBe(6);
  });

  it('handles boundary at exactly 10 KB/s (10240 bytes)', () => {
    const rates = { c1: { rxBytesPerSec: 10_240, txBytesPerSec: 0 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#eab308'); // yellow, >= 10KB threshold
    expect(style.strokeWidth).toBe(3);
  });

  it('handles boundary at exactly 1 MB/s (1048576 bytes)', () => {
    const rates = { c1: { rxBytesPerSec: 1_048_576, txBytesPerSec: 0 } };
    const style = getEdgeStyle('c1', 'running', rates);
    expect(style.stroke).toBe('#ef4444'); // red, >= 1MB threshold
    expect(style.strokeWidth).toBe(6);
  });
});
