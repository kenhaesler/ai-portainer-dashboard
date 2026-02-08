import { describe, it, expect } from 'vitest';
import { isRecoverableToolCallParseError, formatChatContext, getAuthHeaders } from './llm-chat.js';

describe('getAuthHeaders', () => {
  it('returns empty object when token is undefined', () => {
    expect(getAuthHeaders(undefined)).toEqual({});
  });

  it('returns empty object when token is empty string', () => {
    expect(getAuthHeaders('')).toEqual({});
  });

  it('returns Bearer header for simple token', () => {
    expect(getAuthHeaders('my-secret-token')).toEqual({
      Authorization: 'Bearer my-secret-token',
    });
  });

  it('returns Basic header for username:password format', () => {
    const result = getAuthHeaders('admin:secret123');
    const expected = Buffer.from('admin:secret123').toString('base64');
    expect(result).toEqual({
      Authorization: `Basic ${expected}`,
    });
  });
});

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

describe('formatChatContext', () => {
  it('returns empty string for empty context', () => {
    expect(formatChatContext({})).toBe('');
  });

  it('formats metrics-dashboard context with container focus instructions', () => {
    const result = formatChatContext({
      page: 'metrics-dashboard',
      containerName: 'cpu-burster',
      containerId: 'abc123',
      endpointId: 1,
      timeRange: '24h',
      currentMetrics: { cpuAvg: 40.8, memoryAvg: 62.3 },
    });

    expect(result).toContain('ACTIVE FOCUS');
    expect(result).toContain('cpu-burster');
    expect(result).toContain('abc123');
    expect(result).toContain('Endpoint ID**: 1');
    expect(result).toContain('24h');
    expect(result).toContain('40.8%');
    expect(result).toContain('62.3%');
    expect(result).toContain('do NOT ask the user which container');
    expect(result).toContain('container_name="cpu-burster"');
  });

  it('omits missing optional fields from metrics-dashboard context', () => {
    const result = formatChatContext({
      page: 'metrics-dashboard',
      containerName: 'web-api',
      endpointId: 2,
    });

    expect(result).toContain('web-api');
    expect(result).toContain('ACTIVE FOCUS');
    expect(result).not.toContain('Container ID');
    expect(result).not.toContain('avg CPU');
    expect(result).not.toContain('avg Memory');
  });

  it('falls back to generic format for non-metrics pages', () => {
    const result = formatChatContext({
      page: 'containers',
      selectedFilter: 'running',
    });

    expect(result).toContain('Additional Context');
    expect(result).toContain('**page**: containers');
    expect(result).toContain('**selectedFilter**: running');
    expect(result).not.toContain('ACTIVE FOCUS');
  });

  it('falls back to generic format when metrics-dashboard has no containerName', () => {
    const result = formatChatContext({
      page: 'metrics-dashboard',
      endpointId: 1,
    });

    expect(result).toContain('Additional Context');
    expect(result).not.toContain('ACTIVE FOCUS');
  });
});
