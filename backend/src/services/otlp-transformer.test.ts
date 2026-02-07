import { describe, expect, it } from 'vitest';
import { transformOtlpToSpans, type OtlpExportRequest } from './otlp-transformer.js';

function makePayload(overrides?: Partial<OtlpExportRequest>): OtlpExportRequest {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'my-app' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'beyla', version: '1.0' },
            spans: [
              {
                traceId: 'abc123def456',
                spanId: 'span001',
                parentSpanId: 'parentspan001',
                name: 'GET /api/users',
                kind: 2,
                startTimeUnixNano: '1700000000000000000',
                endTimeUnixNano: '1700000000150000000',
                status: { code: 1 },
                attributes: [
                  { key: 'http.method', value: { stringValue: 'GET' } },
                  { key: 'http.status_code', value: { intValue: 200 } },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('transformOtlpToSpans', () => {
  it('converts valid OTLP JSON with a single span', () => {
    const result = transformOtlpToSpans(makePayload());

    expect(result).toHaveLength(1);
    const span = result[0];
    expect(span.id).toBe('span001');
    expect(span.trace_id).toBe('abc123def456');
    expect(span.parent_span_id).toBe('parentspan001');
    expect(span.name).toBe('GET /api/users');
    expect(span.kind).toBe('server');
    expect(span.status).toBe('ok');
    expect(span.service_name).toBe('my-app');
    expect(span.trace_source).toBe('ebpf');
    expect(span.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(span.end_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(span.duration_ms).toBe(150);

    const attrs = JSON.parse(span.attributes);
    expect(attrs['http.method']).toBe('GET');
    expect(attrs['http.status_code']).toBe(200);
    expect(attrs['service.name']).toBe('my-app');
  });

  it('converts multiple resourceSpans and scopeSpans', () => {
    const payload: OtlpExportRequest = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1', spanId: 's1', name: 'op1', kind: 2,
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000100000000',
                },
              ],
            },
            {
              spans: [
                {
                  traceId: 't1', spanId: 's2', name: 'op2', kind: 3,
                  startTimeUnixNano: '1700000000050000000',
                  endTimeUnixNano: '1700000000080000000',
                },
              ],
            },
          ],
        },
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'svc-b' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't2', spanId: 's3', name: 'op3', kind: 1,
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000200000000',
                },
              ],
            },
          ],
        },
      ],
    };

    const result = transformOtlpToSpans(payload);
    expect(result).toHaveLength(3);
    expect(result[0].service_name).toBe('svc-a');
    expect(result[0].kind).toBe('server');
    expect(result[1].service_name).toBe('svc-a');
    expect(result[1].kind).toBe('client');
    expect(result[2].service_name).toBe('svc-b');
    expect(result[2].kind).toBe('internal');
  });

  it('handles missing optional fields', () => {
    const payload: OtlpExportRequest = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'minimal-span',
                  startTimeUnixNano: '1700000000000000000',
                },
              ],
            },
          ],
        },
      ],
    };

    const result = transformOtlpToSpans(payload);
    expect(result).toHaveLength(1);
    const span = result[0];
    expect(span.parent_span_id).toBeNull();
    expect(span.end_time).toBeNull();
    expect(span.duration_ms).toBeNull();
    expect(span.kind).toBe('internal');
    expect(span.status).toBe('unset');
    expect(span.service_name).toBe('unknown');
    expect(JSON.parse(span.attributes)).toEqual({});
  });

  it('maps all 3 kind values correctly', () => {
    const makeSpanWithKind = (kind: number) => ({
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeSpans: [{
          spans: [{
            traceId: 't', spanId: `s${kind}`, name: 'op',
            kind,
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000000100000000',
          }],
        }],
      }],
    });

    expect(transformOtlpToSpans(makeSpanWithKind(1))[0].kind).toBe('internal');
    expect(transformOtlpToSpans(makeSpanWithKind(2))[0].kind).toBe('server');
    expect(transformOtlpToSpans(makeSpanWithKind(3))[0].kind).toBe('client');
  });

  it('maps all 3 status codes correctly', () => {
    const makeSpanWithStatus = (code: number) => ({
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeSpans: [{
          spans: [{
            traceId: 't', spanId: `s${code}`, name: 'op',
            startTimeUnixNano: '1700000000000000000',
            status: { code },
          }],
        }],
      }],
    });

    expect(transformOtlpToSpans(makeSpanWithStatus(0))[0].status).toBe('unset');
    expect(transformOtlpToSpans(makeSpanWithStatus(1))[0].status).toBe('ok');
    expect(transformOtlpToSpans(makeSpanWithStatus(2))[0].status).toBe('error');
  });

  it('extracts service.name from resource attributes', () => {
    const result = transformOtlpToSpans(makePayload());
    expect(result[0].service_name).toBe('my-app');
  });

  it('computes duration_ms from nanosecond timestamps', () => {
    const payload: OtlpExportRequest = {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: 't', spanId: 's', name: 'op',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000000500000000',
          }],
        }],
      }],
    };

    const result = transformOtlpToSpans(payload);
    expect(result[0].duration_ms).toBe(500);
  });

  it('handles empty resourceSpans array', () => {
    expect(transformOtlpToSpans({ resourceSpans: [] })).toEqual([]);
  });

  it('handles null/undefined payload gracefully', () => {
    expect(transformOtlpToSpans(null as unknown as OtlpExportRequest)).toEqual([]);
    expect(transformOtlpToSpans(undefined as unknown as OtlpExportRequest)).toEqual([]);
  });

  it('handles missing scopeSpans gracefully', () => {
    const payload = {
      resourceSpans: [{ resource: { attributes: [] } } as unknown as OtlpExportRequest['resourceSpans'][0]],
    };
    expect(transformOtlpToSpans(payload)).toEqual([]);
  });

  it('flattens various attribute value types', () => {
    const payload: OtlpExportRequest = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeSpans: [{
          spans: [{
            traceId: 't', spanId: 's', name: 'op',
            startTimeUnixNano: '1700000000000000000',
            attributes: [
              { key: 'str', value: { stringValue: 'hello' } },
              { key: 'int', value: { intValue: 42 } },
              { key: 'double', value: { doubleValue: 3.14 } },
              { key: 'bool', value: { boolValue: true } },
              { key: 'int_str', value: { intValue: '99' } },
            ],
          }],
        }],
      }],
    };

    const result = transformOtlpToSpans(payload);
    const attrs = JSON.parse(result[0].attributes);
    expect(attrs.str).toBe('hello');
    expect(attrs.int).toBe(42);
    expect(attrs.double).toBe(3.14);
    expect(attrs.bool).toBe(true);
    expect(attrs.int_str).toBe(99);
  });
});
