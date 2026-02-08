import protobuf from 'protobufjs';
import type { OtlpExportRequest } from './otlp-transformer.js';

// ─── Inline OTLP trace proto schema ────────────────────────────────
// Minimal subset of opentelemetry-proto/trace/v1/trace_service.proto
// needed to decode ExportTraceServiceRequest from Beyla.
const OTLP_TRACE_PROTO = `
syntax = "proto3";
package opentelemetry.proto.collector.trace.v1;

message ExportTraceServiceRequest {
  repeated ResourceSpans resource_spans = 1;
}

message ResourceSpans {
  Resource resource = 1;
  repeated ScopeSpans scope_spans = 2;
}

message Resource {
  repeated KeyValue attributes = 1;
}

message ScopeSpans {
  InstrumentationScope scope = 1;
  repeated Span spans = 2;
}

message InstrumentationScope {
  string name = 1;
  string version = 2;
}

message Span {
  bytes trace_id = 1;
  bytes span_id = 2;
  string trace_state = 3;
  bytes parent_span_id = 4;
  string name = 5;
  SpanKind kind = 6;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9;
  Status status = 15;
}

enum SpanKind {
  SPAN_KIND_UNSPECIFIED = 0;
  SPAN_KIND_INTERNAL = 1;
  SPAN_KIND_SERVER = 2;
  SPAN_KIND_CLIENT = 3;
  SPAN_KIND_PRODUCER = 4;
  SPAN_KIND_CONSUMER = 5;
}

message Status {
  string message = 2;
  StatusCode code = 3;
}

enum StatusCode {
  STATUS_CODE_UNSET = 0;
  STATUS_CODE_OK = 1;
  STATUS_CODE_ERROR = 2;
}

message KeyValue {
  string key = 1;
  AnyValue value = 2;
}

message AnyValue {
  oneof value {
    string string_value = 1;
    bool bool_value = 2;
    int64 int_value = 3;
    double double_value = 4;
    ArrayValue array_value = 5;
    KeyValueList kvlist_value = 6;
    bytes bytes_value = 7;
  }
}

message ArrayValue {
  repeated AnyValue values = 1;
}

message KeyValueList {
  repeated KeyValue values = 1;
}
`;

let ExportTraceServiceRequest: protobuf.Type | null = null;

function getProtoType(): protobuf.Type {
  if (!ExportTraceServiceRequest) {
    const root = protobuf.parse(OTLP_TRACE_PROTO).root;
    ExportTraceServiceRequest = root.lookupType(
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
    );
  }
  return ExportTraceServiceRequest;
}

// ─── Helpers ────────────────────────────────────────────────────────

function bytesToHex(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf).toString('hex');
}

function nanosToString(value: number | Long | bigint): string {
  return String(value);
}

 
function convertAnyValue(av: any): { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean } {
  if (!av) return {};
  if (av.stringValue !== undefined && av.stringValue !== null) return { stringValue: av.stringValue };
  if (av.intValue !== undefined && av.intValue !== null) return { intValue: Number(av.intValue) };
  if (av.doubleValue !== undefined && av.doubleValue !== null) return { doubleValue: av.doubleValue };
  if (av.boolValue !== undefined && av.boolValue !== null) return { boolValue: av.boolValue };
  return {};
}

 
function convertKeyValues(kvs: any[]): Array<{ key: string; value: any }> {
  if (!kvs) return [];
  return kvs.map((kv) => ({
    key: kv.key,
    value: convertAnyValue(kv.value),
  }));
}

// ─── Decode protobuf to OTLP JSON ──────────────────────────────────

export function decodeOtlpProtobuf(buffer: Buffer): OtlpExportRequest {
  const ProtoType = getProtoType();
  const message = ProtoType.decode(buffer);
  const obj = ProtoType.toObject(message, {
    longs: String,
    bytes: Buffer,
    defaults: true,
   
  }) as any;

  const resourceSpans = (obj.resourceSpans || []).map((rs: any) => ({
    resource: rs.resource ? {
      attributes: convertKeyValues(rs.resource.attributes),
    } : undefined,
    scopeSpans: (rs.scopeSpans || []).map((ss: any) => ({
      scope: ss.scope ? { name: ss.scope.name, version: ss.scope.version } : undefined,
      spans: (ss.spans || []).map((span: any) => ({
        traceId: span.traceId ? bytesToHex(span.traceId) : '',
        spanId: span.spanId ? bytesToHex(span.spanId) : '',
        parentSpanId: span.parentSpanId && span.parentSpanId.length > 0
          ? bytesToHex(span.parentSpanId)
          : undefined,
        name: span.name || '',
        kind: span.kind || 0,
        startTimeUnixNano: nanosToString(span.startTimeUnixNano),
        endTimeUnixNano: span.endTimeUnixNano ? nanosToString(span.endTimeUnixNano) : undefined,
        status: span.status ? {
          code: span.status.code || 0,
          message: span.status.message,
        } : undefined,
        attributes: convertKeyValues(span.attributes),
      })),
    })),
  }));

  return { resourceSpans };
}

// Long type from protobufjs
interface Long {
  low: number;
  high: number;
  unsigned: boolean;
  toString(): string;
}
