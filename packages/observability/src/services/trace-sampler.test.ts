import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSampler } from './trace-sampler.js';

function span(traceId: string, service: string = 'a', namespace?: string) {
  return {
    trace_id: traceId,
    service_name: service,
    service_namespace: namespace,
  };
}

describe('createSampler', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('head sampling is deterministic on trace_id', () => {
    const s = createSampler({ sampleRate: 0.5, maxSpansPerSec: 0 });
    const tid = '0123456789abcdef0123456789abcdef';
    const d1 = s.shouldAccept(span(tid));
    const d2 = s.shouldAccept(span(tid));
    expect(d1).toBe(d2);
  });

  it('sampleRate=1.0 accepts all', () => {
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 0 });
    for (let i = 0; i < 100; i++) {
      expect(s.shouldAccept(span(`t${i}`.padEnd(32, '0')))).toBe(true);
    }
  });

  it('sampleRate=0 rejects all', () => {
    const s = createSampler({ sampleRate: 0, maxSpansPerSec: 0 });
    expect(s.shouldAccept(span('x'.repeat(32)))).toBe(false);
  });

  it('token-bucket drops above maxSpansPerSec', () => {
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 10 });
    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      if (s.shouldAccept(span(`t${i}`.padEnd(32, '0')))) accepted++;
    }
    expect(accepted).toBeLessThanOrEqual(10);
  });

  it('per-source isolation: one noisy service does not affect another', () => {
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 5 });
    for (let i = 0; i < 50; i++) {
      s.shouldAccept(span(`t${i}`.padEnd(32, '0'), 'noisy'));
    }
    // After noisy used up its quota, quiet still has a fresh bucket.
    expect(s.shouldAccept(span('z'.repeat(32), 'quiet'))).toBe(true);
  });

  it('getStats reports accepted/dropped totals', () => {
    const s = createSampler({ sampleRate: 0, maxSpansPerSec: 0 });
    for (let i = 0; i < 5; i++) {
      s.shouldAccept(span(`t${i}`.padEnd(32, '0')));
    }
    expect(s.getStats().droppedTotal).toBe(5);
    expect(s.getStats().acceptedTotal).toBe(0);
  });

  it('namespace takes precedence over service for per-source keying', () => {
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 1 });
    // First accepted (drains bucket for namespace=ns1)
    expect(s.shouldAccept(span('a'.repeat(32), 'svc-a', 'ns1'))).toBe(true);
    // Same namespace, different service — still keyed on ns1, so dropped.
    expect(s.shouldAccept(span('b'.repeat(32), 'svc-b', 'ns1'))).toBe(false);
    // Different namespace — fresh bucket.
    expect(s.shouldAccept(span('c'.repeat(32), 'svc-a', 'ns2'))).toBe(true);
  });
});
