import { describe, it, expect } from 'vitest';
import { streamOpenAiContent, extractApiError } from '../services/sse-stream.js';

/** Build a Response whose body emits the given byte chunks — one per read(). */
function responseFromChunks(chunks: Uint8Array[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of gen) out.push(delta);
  return out;
}

const enc = new TextEncoder();

describe('streamOpenAiContent', () => {
  it('yields content deltas for whole-line SSE payloads', async () => {
    const payload = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const out = await collect(streamOpenAiContent(responseFromChunks([enc.encode(payload)])));
    expect(out).toEqual(['Hello', ' world']);
  });

  it('reassembles a data: line split across two reads (the #1510 bug)', async () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello world"}}]}\n';
    const bytes = enc.encode(line);
    // Split mid-JSON, before the trailing newline — the old per-chunk parser
    // dropped both halves; the buffered reader must reassemble them.
    const splitAt = 28;
    const out = await collect(
      streamOpenAiContent(responseFromChunks([bytes.slice(0, splitAt), bytes.slice(splitAt)])),
    );
    expect(out.join('')).toBe('Hello world');
  });

  it('decodes multi-byte UTF-8 and split lines under byte-by-byte reads', async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"Héllo"}}]}\n' +
      'data: {"choices":[{"delta":{"content":" 世界 ☕"}}]}\n' +
      'data: [DONE]\n';
    // One byte per read() — splits every line AND every multi-byte character.
    // Without decoder {stream:true}, split chars would decode to U+FFFD.
    const chunks = Array.from(enc.encode(payload), (b) => new Uint8Array([b]));
    const out = await collect(streamOpenAiContent(responseFromChunks(chunks)));
    expect(out.join('')).toBe('Héllo 世界 ☕');
    expect(out.join('')).not.toContain('�');
  });

  it('skips [DONE], SSE comments, and non-JSON keep-alive lines', async () => {
    const payload = [
      ': keep-alive',
      'event: message',
      'data: {"choices":[{"delta":{"content":"A"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const out = await collect(streamOpenAiContent(responseFromChunks([enc.encode(payload)])));
    expect(out).toEqual(['A']);
  });

  it('processes a final line that arrives without a trailing newline', async () => {
    const payload = 'data: {"choices":[{"delta":{"content":"tail"}}]}';
    const out = await collect(streamOpenAiContent(responseFromChunks([enc.encode(payload)])));
    expect(out).toEqual(['tail']);
  });

  it('supports the message.content shape as well as choices[].delta.content', async () => {
    const payload = 'data: {"message":{"content":"from-message"}}\n';
    const out = await collect(streamOpenAiContent(responseFromChunks([enc.encode(payload)])));
    expect(out).toEqual(['from-message']);
  });

  it('throws when the stream carries an { error } body', async () => {
    const payload = 'data: {"error":{"message":"bad model"}}\n';
    await expect(
      collect(streamOpenAiContent(responseFromChunks([enc.encode(payload)]))),
    ).rejects.toThrow(/bad model/);
  });

  it('stops without reading when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const payload = 'data: {"choices":[{"delta":{"content":"one"}}]}\n';
    const out = await collect(
      streamOpenAiContent(responseFromChunks([enc.encode(payload)]), { signal: controller.signal }),
    );
    expect(out).toEqual([]);
  });

  it('throws when the response body is not readable', async () => {
    await expect(collect(streamOpenAiContent(new Response(null, { status: 200 })))).rejects.toThrow(
      /not readable/,
    );
  });
});

describe('extractApiError', () => {
  it('returns null for non-error payloads', () => {
    expect(extractApiError(null)).toBeNull();
    expect(extractApiError({ choices: [{ delta: { content: 'hi' } }] })).toBeNull();
  });

  it('extracts string and nested-message error bodies', () => {
    expect(extractApiError({ error: 'boom' })).toBe('boom');
    expect(extractApiError({ error: { message: 'Invalid API key' } })).toBe('Invalid API key');
  });
});
