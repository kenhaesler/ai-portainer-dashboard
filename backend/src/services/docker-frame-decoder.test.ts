import { describe, it, expect } from 'vitest';
import { IncrementalDockerFrameDecoder } from './docker-frame-decoder.js';

/** Build a Docker multiplexed frame: [streamType, 0, 0, 0, len(4 bytes BE), payload] */
function makeFrame(payload: string, streamType = 1): Buffer {
  const payloadBuf = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  // bytes 1-3 are already 0
  header.writeUInt32BE(payloadBuf.length, 4);
  return Buffer.concat([header, payloadBuf]);
}

describe('IncrementalDockerFrameDecoder', () => {
  it('decodes a complete single stdout frame', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame = makeFrame('hello world\n');
    const lines = decoder.push(frame);
    expect(lines).toEqual(['hello world']);
  });

  it('decodes a complete stderr frame', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame = makeFrame('error happened\n', 2);
    const lines = decoder.push(frame);
    expect(lines).toEqual(['error happened']);
  });

  it('decodes multiple concatenated frames in one push', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame1 = makeFrame('line one\n');
    const frame2 = makeFrame('line two\n');
    const lines = decoder.push(Buffer.concat([frame1, frame2]));
    expect(lines).toEqual(['line one', 'line two']);
  });

  it('handles a frame split across two pushes (partial header)', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame = makeFrame('split frame\n');

    // Split in the middle of the header (at byte 4)
    const part1 = frame.subarray(0, 4);
    const part2 = frame.subarray(4);

    const lines1 = decoder.push(part1);
    expect(lines1).toEqual([]);

    const lines2 = decoder.push(part2);
    expect(lines2).toEqual(['split frame']);
  });

  it('handles a frame split across two pushes (partial payload)', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame = makeFrame('partial payload\n');

    // Split in the middle of the payload
    const splitAt = 12; // header(8) + 4 bytes of payload
    const part1 = frame.subarray(0, splitAt);
    const part2 = frame.subarray(splitAt);

    const lines1 = decoder.push(part1);
    expect(lines1).toEqual([]);

    const lines2 = decoder.push(part2);
    expect(lines2).toEqual(['partial payload']);
  });

  it('falls back to raw text for non-framed data', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const raw = Buffer.from('plain log line 1\nplain log line 2\n', 'utf8');
    const lines = decoder.push(raw);
    expect(lines).toEqual(['plain log line 1', 'plain log line 2']);
  });

  it('drain() returns remaining buffered content', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    // Push raw text without trailing newline
    const raw = Buffer.from('first line\nincomplete', 'utf8');
    const lines = decoder.push(raw);
    expect(lines).toEqual(['first line']);

    const remaining = decoder.drain();
    expect(remaining).toEqual(['incomplete']);
  });

  it('returns empty array for empty input', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const lines = decoder.push(Buffer.alloc(0));
    expect(lines).toEqual([]);
  });

  it('drain() returns empty array when buffer is empty', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    expect(decoder.drain()).toEqual([]);
  });

  it('handles frames with multiple newline-separated lines in one payload', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame = makeFrame('line A\nline B\nline C\n');
    const lines = decoder.push(frame);
    expect(lines).toEqual(['line A', 'line B', 'line C']);
  });

  it('handles large payload spanning multiple reads', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const bigPayload = 'x'.repeat(4096) + '\n';
    const frame = makeFrame(bigPayload);

    // Deliver in 512-byte chunks
    const allLines: string[] = [];
    for (let i = 0; i < frame.length; i += 512) {
      const chunk = frame.subarray(i, Math.min(i + 512, frame.length));
      allLines.push(...decoder.push(chunk));
    }

    expect(allLines).toEqual(['x'.repeat(4096)]);
  });

  it('handles stream type 0 (stdin) frames', () => {
    const decoder = new IncrementalDockerFrameDecoder();
    const frame = makeFrame('stdin data\n', 0);
    const lines = decoder.push(frame);
    expect(lines).toEqual(['stdin data']);
  });
});
