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

function pickString(attrs: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = attrs[key];
    if (value === undefined || value === null) continue;
    const asString = String(value).trim();
    if (asString) return asString;
  }
  return null;
}

function pickInt(attrs: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = attrs[key];
    if (value === undefined || value === null || value === '') continue;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return Math.trunc(asNumber);
  }
  return null;
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
          http_method: pickString(allAttributes, ['http.method']),
          http_route: pickString(allAttributes, ['http.route', 'url.path', 'http.target']),
          http_status_code: pickInt(allAttributes, ['http.status_code']),
          service_namespace: pickString(allAttributes, ['service.namespace']),
          service_instance_id: pickString(allAttributes, ['service.instance.id']),
          service_version: pickString(allAttributes, ['service.version']),
          deployment_environment: pickString(allAttributes, ['deployment.environment']),
          container_id: pickString(allAttributes, ['container.id']),
          container_name: pickString(allAttributes, ['container.name', 'k8s.container.name']),
          k8s_namespace: pickString(allAttributes, ['k8s.namespace.name']),
          k8s_pod_name: pickString(allAttributes, ['k8s.pod.name']),
          k8s_container_name: pickString(allAttributes, ['k8s.container.name']),
          server_address: pickString(allAttributes, ['server.address', 'net.host.name']),
          server_port: pickInt(allAttributes, ['server.port', 'net.host.port']),
          client_address: pickString(allAttributes, ['client.address', 'net.sock.peer.addr']),
        });
      }
    }
  }

  return spans;
}
