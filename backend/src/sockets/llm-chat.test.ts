import { describe, it, expect } from 'vitest';
import { isRecoverableToolCallParseError } from './llm-chat.js';

describe('isRecoverableToolCallParseError', () => {
  it('returns true for known tool-call parser failures', () => {
    const err = new Error(
      `error parsing tool call: raw='{"tool_calls":[{"tool":"get_container_logs","arguments":{"container_name":"backend","tail":50}}]', err=unexpected end of JSON input`,
    );
    expect(isRecoverableToolCallParseError(err)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRecoverableToolCallParseError(new Error('HTTP 500 internal server error'))).toBe(false);
    expect(isRecoverableToolCallParseError(new Error('timeout'))).toBe(false);
  });
});
