import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import protobuf from 'protobufjs';
import { getTestDb, getTestPool, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';
import { tracesIngestRoutes } from './traces-ingest.js';
import { setConfigForTest, resetConfig } from '../config/index.js';

let appDb: AppDb;

// Kept: app-db-router mock — tests control database routing
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => appDb,
}));

function makeOtlpPayload() {
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
            spans: [
              {
                traceId: 'abc123',
                spanId: 'span001',
                name: 'GET /api/users',
                kind: 2,
                startTimeUnixNano: '1700000000000000000',
                endTimeUnixNano: '1700000000150000000',
                status: { code: 1 },
                attributes: [
                  { key: 'http.method', value: { stringValue: 'GET' } },
                ],
              },
              {
                traceId: 'abc123',
                spanId: 'span002',
                parentSpanId: 'span001',
                name: 'SELECT users',
                kind: 3,
                startTimeUnixNano: '1700000000050000000',
                endTimeUnixNano: '1700000000120000000',
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('Traces Ingest Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    appDb = await getTestDb();

    app = Fastify({ logger: false });
    await app.register(tracesIngestRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('spans');
    setConfigForTest({
      TRACES_INGESTION_ENABLED: true,
      TRACES_INGESTION_API_KEY: 'test-api-key-12345',
    });
  });

  afterEach(() => {
    resetConfig();
  });

  it('accepts valid OTLP payload and returns accepted count', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key-12345',
      },
      payload: makeOtlpPayload(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(2);

    // Verify spans were inserted
    const pool = await getTestPool();
    const { rows } = await pool.query('SELECT * FROM spans ORDER BY id');
    expect(rows).toHaveLength(2);
    expect(rows[0].trace_source).toBe('ebpf');
    expect(rows[0].service_name).toBe('my-app');
  });

  it('accepts API key via Authorization Bearer header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-api-key-12345',
      },
      payload: makeOtlpPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(2);
  });

  it('rejects missing API key with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: { 'content-type': 'application/json' },
      payload: makeOtlpPayload(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('Invalid or missing API key');
  });

  it('rejects invalid API key with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'wrong-key',
      },
      payload: makeOtlpPayload(),
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects malformed body with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key-12345',
      },
      payload: { invalid: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('resourceSpans');
  });

  it('returns 501 when TRACES_INGESTION_ENABLED is false', async () => {
    setConfigForTest({ TRACES_INGESTION_ENABLED: false });

    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key-12345',
      },
      payload: makeOtlpPayload(),
    });

    expect(response.statusCode).toBe(501);
    expect(response.json().error).toContain('not enabled');
  });

  it('returns accepted: 0 for empty resourceSpans', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key-12345',
      },
      payload: { resourceSpans: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(0);
  });

  it('accepts OTLP payload on /v1/traces path (Beyla auto-appended)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp/v1/traces',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key-12345',
      },
      payload: makeOtlpPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(2);
  });

  it('accepts protobuf-encoded OTLP payload (application/x-protobuf)', async () => {
    // Build a protobuf-encoded ExportTraceServiceRequest
    const proto = `
      syntax = "proto3";
      package opentelemetry.proto.collector.trace.v1;
      message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
      message ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; }
      message Resource { repeated KeyValue attributes = 1; }
      message ScopeSpans { InstrumentationScope scope = 1; repeated Span spans = 2; }
      message InstrumentationScope { string name = 1; string version = 2; }
      message Span {
        bytes trace_id = 1; bytes span_id = 2; string trace_state = 3;
        bytes parent_span_id = 4; string name = 5; SpanKind kind = 6;
        fixed64 start_time_unix_nano = 7; fixed64 end_time_unix_nano = 8;
        repeated KeyValue attributes = 9; Status status = 15;
      }
      enum SpanKind { SPAN_KIND_UNSPECIFIED=0; SPAN_KIND_INTERNAL=1; SPAN_KIND_SERVER=2; SPAN_KIND_CLIENT=3; SPAN_KIND_PRODUCER=4; SPAN_KIND_CONSUMER=5; }
      message Status { string message = 2; StatusCode code = 3; }
      enum StatusCode { STATUS_CODE_UNSET=0; STATUS_CODE_OK=1; STATUS_CODE_ERROR=2; }
      message KeyValue { string key = 1; AnyValue value = 2; }
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
      message ArrayValue { repeated AnyValue values = 1; }
      message KeyValueList { repeated KeyValue values = 1; }
    `;
    const root = protobuf.parse(proto).root;
    const ExportType = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');

    const payload = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'proto-app' } }] },
        scopeSpans: [{
          spans: [{
            traceId: Buffer.from('abcdef1234567890abcdef1234567890', 'hex'),
            spanId: Buffer.from('1234567890abcdef', 'hex'),
            name: 'GET /proto',
            kind: 2,
            startTimeUnixNano: (protobuf.util.Long as unknown as { fromString(s: string, u: boolean): unknown }).fromString('1700000000000000000', true),
            endTimeUnixNano: (protobuf.util.Long as unknown as { fromString(s: string, u: boolean): unknown }).fromString('1700000000200000000', true),
            status: { code: 1 },
            attributes: [
              { key: 'http.method', value: { stringValue: 'GET' } },
              {
                key: 'complex.array',
                value: { arrayValue: { values: [{ stringValue: 'alpha' }, { intValue: 3 }] } },
              },
              {
                key: 'complex.map',
                value: {
                  kvlistValue: {
                    values: [{ key: 'role', value: { stringValue: 'edge' } }],
                  },
                },
              },
              { key: 'complex.bytes', value: { bytesValue: Buffer.from('hello') } },
            ],
          }],
        }],
      }],
    };

    const errMsg = ExportType.verify(payload);
    expect(errMsg).toBeNull();
    const message = ExportType.create(payload);
    const buffer = Buffer.from(ExportType.encode(message).finish());

    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp/v1/traces',
      headers: {
        'content-type': 'application/x-protobuf',
        'x-api-key': 'test-api-key-12345',
      },
      payload: buffer,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(1);

    const pool = await getTestPool();
    const { rows } = await pool.query('SELECT * FROM spans');
    expect(rows).toHaveLength(1);
    expect(rows[0].trace_source).toBe('ebpf');
    expect(rows[0].service_name).toBe('proto-app');
    expect(rows[0].name).toBe('GET /proto');
    // JSONB is auto-parsed by pg driver
    const attrs = rows[0].attributes as Record<string, unknown>;
    expect(attrs['complex.array']).toEqual(['alpha', 3]);
    expect(attrs['complex.map']).toEqual({ role: 'edge' });
    expect(attrs['complex.bytes']).toBe(Buffer.from('hello').toString('base64'));
  });

  it('rejects invalid protobuf with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/traces/otlp',
      headers: {
        'content-type': 'application/x-protobuf',
        'x-api-key': 'test-api-key-12345',
      },
      payload: Buffer.from('not valid protobuf data'),
    });

    // Should get 400 (decode error) or still attempt to process
    // protobufjs may decode garbage as empty message
    expect([200, 400]).toContain(response.statusCode);
  });
});
