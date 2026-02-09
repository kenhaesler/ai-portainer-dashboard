import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatIndexDate,
  buildBulkBody,
  sendBulk,
  createElasticsearchTransport,
  type ElasticsearchTransportStream,
} from './pino-elasticsearch-transport.js';

describe('pino-elasticsearch-transport', () => {
  describe('formatIndexDate', () => {
    it('should format date as YYYY.MM.DD in UTC', () => {
      const date = new Date('2026-02-08T15:30:00Z');
      expect(formatIndexDate(date)).toBe('2026.02.08');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date('2026-01-05T00:00:00Z');
      expect(formatIndexDate(date)).toBe('2026.01.05');
    });

    it('should handle year boundaries', () => {
      const date = new Date('2025-12-31T23:59:59Z');
      expect(formatIndexDate(date)).toBe('2025.12.31');
    });
  });

  describe('buildBulkBody', () => {
    it('should produce NDJSON with action and document lines', () => {
      const logs = [
        { time: new Date('2026-02-08T10:00:00Z').getTime(), level: 30, msg: 'hello' },
      ];
      const body = buildBulkBody(logs, 'app-logs');
      const lines = body.split('\n').filter(Boolean);

      expect(lines).toHaveLength(2);

      const action = JSON.parse(lines[0]);
      expect(action).toEqual({ index: { _index: 'app-logs-2026.02.08' } });

      const doc = JSON.parse(lines[1]);
      expect(doc.msg).toBe('hello');
      expect(doc.level).toBe(30);
    });

    it('should handle multiple logs with different dates', () => {
      const logs = [
        { time: new Date('2026-02-08T10:00:00Z').getTime(), msg: 'first' },
        { time: new Date('2026-02-09T10:00:00Z').getTime(), msg: 'second' },
      ];
      const body = buildBulkBody(logs, 'test');
      const lines = body.split('\n').filter(Boolean);

      expect(lines).toHaveLength(4);

      const action1 = JSON.parse(lines[0]);
      expect(action1.index._index).toBe('test-2026.02.08');

      const action2 = JSON.parse(lines[2]);
      expect(action2.index._index).toBe('test-2026.02.09');
    });

    it('should use current date when log has no time field', () => {
      const logs = [{ msg: 'no timestamp' }];
      const body = buildBulkBody(logs, 'prefix');
      const lines = body.split('\n').filter(Boolean);
      const action = JSON.parse(lines[0]);

      // Should contain today's date in the index name
      const today = formatIndexDate(new Date());
      expect(action.index._index).toBe(`prefix-${today}`);
    });

    it('should terminate each line with newline', () => {
      const logs = [{ time: Date.now(), msg: 'test' }];
      const body = buildBulkBody(logs, 'idx');
      // Body should end with newline
      expect(body.endsWith('\n')).toBe(true);
      // Each line pair ends with newline
      const rawLines = body.split('\n');
      // Last element is empty string after trailing newline
      expect(rawLines[rawLines.length - 1]).toBe('');
    });
  });

  describe('sendBulk', () => {
    const endpoint = 'http://localhost:9200';
    const headers = {};

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true on successful response', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const noDelay = vi.fn().mockResolvedValue(undefined);
      const result = await sendBulk('body\n', endpoint, headers, noDelay);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:9200/_bulk',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-ndjson',
          }),
          body: 'body\n',
        }),
      );
    });

    it('should include Basic auth headers when provided', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const authHeaders = {
        Authorization: 'Basic ' + Buffer.from('user:pass').toString('base64'),
      };
      const noDelay = vi.fn().mockResolvedValue(undefined);
      await sendBulk('body\n', endpoint, authHeaders, noDelay);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic ' + Buffer.from('user:pass').toString('base64'),
          }),
        }),
      );
    });

    it('should retry on server error with exponential backoff', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(new Response('error', { status: 500 }))
        .mockResolvedValueOnce(new Response('error', { status: 502 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const noDelay = vi.fn().mockResolvedValue(undefined);
      const result = await sendBulk('body\n', endpoint, headers, noDelay);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // Exponential backoff: 1s, 2s
      expect(noDelay).toHaveBeenCalledTimes(2);
      expect(noDelay).toHaveBeenCalledWith(1000);
      expect(noDelay).toHaveBeenCalledWith(2000);
    });

    it('should retry on network error', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const noDelay = vi.fn().mockResolvedValue(undefined);
      const result = await sendBulk('body\n', endpoint, headers, noDelay);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 Too Many Requests', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const noDelay = vi.fn().mockResolvedValue(undefined);
      const result = await sendBulk('body\n', endpoint, headers, noDelay);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client errors (except 429)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }));

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const noDelay = vi.fn().mockResolvedValue(undefined);
      const result = await sendBulk('body\n', endpoint, headers, noDelay);

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(noDelay).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });

    it('should drop batch and log warning after 3 failures', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(new Response('error', { status: 500 }))
        .mockResolvedValueOnce(new Response('error', { status: 500 }))
        .mockResolvedValueOnce(new Response('error', { status: 500 }));

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const noDelay = vi.fn().mockResolvedValue(undefined);
      const result = await sendBulk('a\nb\nc\nd\n', endpoint, headers, noDelay);

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send batch after 3 attempts'),
      );

      stdoutSpy.mockRestore();
    });
  });

  describe('createElasticsearchTransport', () => {
    let stream: ElasticsearchTransportStream;

    const defaultOpts = {
      endpoint: 'http://localhost:9200',
      indexPrefix: 'test-logs',
      batchSize: 3,
      flushIntervalMs: 60000, // Long interval so we control flushes manually
    };

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    });

    afterEach(() => {
      if (stream) {
        stream._cleanup();
        stream.destroy();
      }
      vi.restoreAllMocks();
    });

    function writeToStream(s: ElasticsearchTransportStream, data: string): Promise<void> {
      return new Promise((resolve, reject) => {
        s.write(data, (err) => (err ? reject(err) : resolve()));
      });
    }

    it('should buffer logs until batch size is reached', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      // Write 2 logs (below batch size of 3)
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log1' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log2' }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stream._getBuffer()).toHaveLength(2);
    });

    it('should flush when batch size threshold is reached', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log1' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log2' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log3' }));

      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Verify the bulk body contains all 3 logs
      const callBody = fetchMock.mock.calls[0][1]?.body as string;
      const lines = callBody.split('\n').filter(Boolean);
      expect(lines).toHaveLength(6); // 3 action + 3 document lines
    });

    it('should flush on interval timer', async () => {
      vi.useFakeTimers();

      stream = createElasticsearchTransport({
        ...defaultOpts,
        flushIntervalMs: 5000,
      }) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log1' }));

      expect(fetchMock).not.toHaveBeenCalled();

      // Advance time past flush interval
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should send correct NDJSON format to Elasticsearch', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      const timestamp = new Date('2026-02-08T12:00:00Z').getTime();
      await writeToStream(stream, JSON.stringify({ time: timestamp, level: 30, msg: 'test' }));
      await writeToStream(stream, JSON.stringify({ time: timestamp, level: 40, msg: 'warn' }));
      await writeToStream(stream, JSON.stringify({ time: timestamp, level: 50, msg: 'error' }));

      const callBody = fetchMock.mock.calls[0][1]?.body as string;
      const lines = callBody.split('\n').filter(Boolean);

      // Each log becomes 2 NDJSON lines
      for (let i = 0; i < 3; i++) {
        const action = JSON.parse(lines[i * 2]);
        expect(action.index._index).toBe('test-logs-2026.02.08');

        const doc = JSON.parse(lines[i * 2 + 1]);
        expect(doc.time).toBe(timestamp);
      }
    });

    it('should include Basic auth headers when username and password are set', async () => {
      stream = createElasticsearchTransport({
        ...defaultOpts,
        username: 'elastic',
        password: 's3cret',
      }) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log1' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log2' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log3' }));

      const callHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      const expected = 'Basic ' + Buffer.from('elastic:s3cret').toString('base64');
      expect(callHeaders['Authorization']).toBe(expected);
    });

    it('should not include auth header when credentials are not provided', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log1' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log2' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log3' }));

      const callHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['Authorization']).toBeUndefined();
    });

    it('should flush remaining buffer on stream end (graceful shutdown)', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;
      const fetchMock = vi.mocked(fetch);

      // Write 1 log (below batch threshold)
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'final' }));

      expect(fetchMock).not.toHaveBeenCalled();

      // End the stream — triggers final() which flushes
      await new Promise<void>((resolve, reject) => {
        stream.end(() => {
          try {
            expect(fetchMock).toHaveBeenCalledTimes(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('should skip empty lines gracefully', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;

      await writeToStream(stream, '\n');
      await writeToStream(stream, '  \n');

      expect(stream._getBuffer()).toHaveLength(0);
    });

    it('should handle malformed JSON without crashing', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // Should not throw
      await writeToStream(stream, 'not valid json');

      expect(stream._getBuffer()).toHaveLength(0);
      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse log entry'),
      );

      stdoutSpy.mockRestore();
    });

    it('should clear buffer after successful flush', async () => {
      stream = createElasticsearchTransport(defaultOpts) as ElasticsearchTransportStream;

      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log1' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log2' }));
      await writeToStream(stream, JSON.stringify({ time: Date.now(), msg: 'log3' }));

      // Buffer should be empty after flush triggered by batch size
      expect(stream._getBuffer()).toHaveLength(0);
    });

    it('should have a flush timer running', () => {
      stream = createElasticsearchTransport({
        ...defaultOpts,
        flushIntervalMs: 1000,
      }) as ElasticsearchTransportStream;

      expect(stream._getFlushTimer()).not.toBeNull();
    });
  });
});
