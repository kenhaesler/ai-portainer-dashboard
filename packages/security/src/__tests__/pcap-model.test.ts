import { describe, expect, it } from 'vitest';
import { StartCaptureRequestSchema, CaptureListQuerySchema } from '../models/pcap.js';

describe('StartCaptureRequestSchema filter validation', () => {
  const basePayload = {
    endpointId: 1,
    containerId: 'container-1',
    containerName: 'api',
  };

  it('accepts normal BPF syntax without shell operators', () => {
    const result = StartCaptureRequestSchema.safeParse({
      ...basePayload,
      filter: 'tcp and port 443',
    });

    expect(result.success).toBe(true);
  });

  it('rejects ampersand shell operators in filter input', () => {
    const result = StartCaptureRequestSchema.safeParse({
      ...basePayload,
      filter: 'tcp && port 443',
    });

    expect(result.success).toBe(false);
  });

  it('rejects pipe shell operators in filter input', () => {
    const result = StartCaptureRequestSchema.safeParse({
      ...basePayload,
      filter: 'tcp | port 443',
    });

    expect(result.success).toBe(false);
  });
});

describe('CaptureListQuerySchema search', () => {
  it('accepts an optional search string', () => {
    expect(CaptureListQuerySchema.parse({ search: 'web' }).search).toBe('web');
  });
  it('defaults search to undefined when absent', () => {
    expect(CaptureListQuerySchema.parse({}).search).toBeUndefined();
  });
  it('rejects an over-long search string', () => {
    expect(() => CaptureListQuerySchema.parse({ search: 'x'.repeat(201) })).toThrow();
  });
});
