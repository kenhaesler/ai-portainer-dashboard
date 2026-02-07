import type { SpanInsert } from './trace-store.js';

// ─── OTLP JSON types ────────────────────────────────────────────────

interface OtlpKeyValue {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: OtlpKeyValue['value'][] };
  };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  status?: { code?: number; message?: string };
  attributes?: OtlpKeyValue[];
}

interface OtlpScopeSpan {
  scope?: { name?: string; version?: string };
  spans: OtlpSpan[];
}

interface OtlpResourceSpan {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans: OtlpScopeSpan[];
}

export interface OtlpExportRequest {
  resourceSpans: OtlpResourceSpan[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractAttributeValue(value: OtlpKeyValue['value']): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.arrayValue) return value.arrayValue.values.map(extractAttributeValue);
  return undefined;
}

function flattenAttributes(attrs?: OtlpKeyValue[]): Record<string, unknown> {
  if (!attrs || attrs.length === 0) return {};
  const result: Record<string, unknown> = {};
  for (const attr of attrs) {
    result[attr.key] = extractAttributeValue(attr.value);
  }
  return result;
}

function getServiceName(resource?: OtlpResourceSpan['resource']): string {
  if (!resource?.attributes) return 'unknown';
  const attr = resource.attributes.find((a) => a.key === 'service.name');
  return attr?.value?.stringValue ?? 'unknown';
}

function nanosToIso(nanos: string): string {
  const ms = Number(BigInt(nanos) / BigInt(1_000_000));
  return new Date(ms).toISOString();
}

function computeDurationMs(startNanos: string, endNanos?: string): number | null {
  if (!endNanos) return null;
  const durationNanos = BigInt(endNanos) - BigInt(startNanos);
  return Number(durationNanos / BigInt(1_000_000));
}

const OTLP_KIND_MAP: Record<number, 'internal' | 'server' | 'client'> = {
  1: 'internal',
  2: 'server',
  3: 'client',
};

const OTLP_STATUS_MAP: Record<number, 'unset' | 'ok' | 'error'> = {
  0: 'unset',
  1: 'ok',
  2: 'error',
};

// ─── Transformer ────────────────────────────────────────────────────

export function transformOtlpToSpans(payload: OtlpExportRequest): SpanInsert[] {
  const spans: SpanInsert[] = [];

  if (!payload?.resourceSpans) return spans;

  for (const resourceSpan of payload.resourceSpans) {
    const serviceName = getServiceName(resourceSpan.resource);

    if (!resourceSpan.scopeSpans) continue;

    for (const scopeSpan of resourceSpan.scopeSpans) {
      if (!scopeSpan.spans) continue;

      for (const otlpSpan of scopeSpan.spans) {
        const spanAttrs = flattenAttributes(otlpSpan.attributes);
        const resourceAttrs = flattenAttributes(resourceSpan.resource?.attributes);
        const allAttributes = { ...resourceAttrs, ...spanAttrs };

        spans.push({
          id: otlpSpan.spanId,
          trace_id: otlpSpan.traceId,
          parent_span_id: otlpSpan.parentSpanId || null,
          name: otlpSpan.name,
          kind: OTLP_KIND_MAP[otlpSpan.kind ?? 1] ?? 'internal',
          status: OTLP_STATUS_MAP[otlpSpan.status?.code ?? 0] ?? 'unset',
          start_time: nanosToIso(otlpSpan.startTimeUnixNano),
          end_time: otlpSpan.endTimeUnixNano ? nanosToIso(otlpSpan.endTimeUnixNano) : null,
          duration_ms: computeDurationMs(otlpSpan.startTimeUnixNano, otlpSpan.endTimeUnixNano),
          service_name: serviceName,
          attributes: JSON.stringify(allAttributes),
          trace_source: 'ebpf',
        });
      }
    }
  }

  return spans;
}
