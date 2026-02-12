/**
 * Incremental Docker multiplexed stream frame decoder.
 *
 * Docker container logs with `follow=true` return multiplexed frames:
 *   1 byte  — stream type (0=stdin, 1=stdout, 2=stderr)
 *   3 bytes — padding (0x00 0x00 0x00)
 *   4 bytes — payload length (big-endian uint32)
 *   N bytes — payload
 *
 * TCP chunks may split frames at any byte boundary. This class buffers
 * partial frames across `push()` calls and only yields complete lines.
 */
export class IncrementalDockerFrameDecoder {
  private buffer = Buffer.alloc(0);
  private isFramed: boolean | null = null; // null = undetermined

  /**
   * Append a chunk and return any complete log lines extracted.
   */
  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    // First chunk — determine if the stream uses Docker framing
    if (this.isFramed === null) {
      if (this.buffer.length < 8) {
        // Not enough data to determine framing yet
        return [];
      }
      this.isFramed = this.looksLikeFrame(this.buffer, 0);
    }

    if (!this.isFramed) {
      return this.extractRawLines();
    }

    return this.extractFramedLines();
  }

  /**
   * Return any remaining buffered content as final lines.
   * Call this when the upstream stream ends.
   */
  drain(): string[] {
    if (this.buffer.length === 0) return [];

    const text = this.buffer.toString('utf8');
    this.buffer = Buffer.alloc(0);

    return text
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
  }

  /**
   * Check if bytes at `offset` look like a valid Docker frame header.
   */
  private looksLikeFrame(buf: Buffer, offset: number): boolean {
    if (offset + 8 > buf.length) return false;
    const streamType = buf[offset];
    const hasPadding =
      buf[offset + 1] === 0 && buf[offset + 2] === 0 && buf[offset + 3] === 0;
    return hasPadding && (streamType === 0 || streamType === 1 || streamType === 2);
  }

  /**
   * Extract complete frames from the buffer, returning decoded lines.
   */
  private extractFramedLines(): string[] {
    const lines: string[] = [];
    let offset = 0;

    while (offset + 8 <= this.buffer.length) {
      if (!this.looksLikeFrame(this.buffer, offset)) {
        // Remaining data doesn't look framed — treat as raw text
        const remaining = this.buffer.subarray(offset).toString('utf8');
        for (const line of remaining.split('\n')) {
          const trimmed = line.trimEnd();
          if (trimmed.length > 0) lines.push(trimmed);
        }
        offset = this.buffer.length;
        break;
      }

      const size = this.buffer.readUInt32BE(offset + 4);
      const payloadEnd = offset + 8 + size;

      if (payloadEnd > this.buffer.length) {
        // Incomplete frame — wait for more data
        break;
      }

      const payload = this.buffer.subarray(offset + 8, payloadEnd).toString('utf8');
      for (const line of payload.split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed.length > 0) lines.push(trimmed);
      }

      offset = payloadEnd;
    }

    // Keep unprocessed bytes in the buffer
    this.buffer = offset > 0 ? this.buffer.subarray(offset) : this.buffer;
    return lines;
  }

  /**
   * Extract complete lines from raw (non-framed) text.
   */
  private extractRawLines(): string[] {
    const text = this.buffer.toString('utf8');
    const lastNewline = text.lastIndexOf('\n');

    if (lastNewline === -1) {
      // No complete lines yet
      return [];
    }

    const complete = text.substring(0, lastNewline);
    const remainder = text.substring(lastNewline + 1);
    this.buffer = Buffer.from(remainder, 'utf8');

    return complete
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
  }
}
