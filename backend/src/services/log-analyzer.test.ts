import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockReturnValue('You are a test assistant.'),
}));

const mockChatStream = vi.fn();
vi.mock('./llm-client.js', () => ({
  chatStream: (...args: unknown[]) => mockChatStream(...args),
}));

const mockGetContainerLogs = vi.fn();
vi.mock('./portainer-client.js', () => ({
  getContainerLogs: (...args: unknown[]) => mockGetContainerLogs(...args),
}));

// cachedFetch passthrough — invokes the fetcher function directly
vi.mock('./portainer-cache.js', () => ({
  cachedFetch: (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  getCacheKey: (...args: (string | number)[]) => args.join(':'),
}));

import { analyzeContainerLogs, analyzeLogsForContainers } from './log-analyzer.js';

describe('log-analyzer', () => {
  beforeEach(() => {
    mockChatStream.mockReset();
    mockGetContainerLogs.mockReset();
  });

  it('returns analysis when logs contain errors', async () => {
    mockGetContainerLogs.mockResolvedValue(
      '2024-01-01T00:00:00Z ERROR: Connection refused to database\n' +
      '2024-01-01T00:00:01Z WARN: Retrying connection...\n'.repeat(10),
    );

    mockChatStream.mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk(JSON.stringify({
        severity: 'critical',
        summary: 'Database connection failures detected',
        errorPatterns: ['Connection refused', 'Retrying connection'],
      }));
      return Promise.resolve('');
    });

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe('critical');
    expect(result!.summary).toBe('Database connection failures detected');
    expect(result!.errorPatterns).toContain('Connection refused');
    expect(result!.containerId).toBe('container-1');
    expect(result!.containerName).toBe('web-app');
  });

  it('returns null for clean logs (LLM returns null)', async () => {
    mockGetContainerLogs.mockResolvedValue(
      '2024-01-01T00:00:00Z INFO: Server started on port 3000\n'.repeat(10),
    );

    mockChatStream.mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk('null');
      return Promise.resolve('');
    });

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);
    expect(result).toBeNull();
  });

  it('returns null when logs are empty', async () => {
    mockGetContainerLogs.mockResolvedValue('');

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);
    expect(result).toBeNull();
    expect(mockChatStream).not.toHaveBeenCalled();
  });

  it('returns null when LLM fails', async () => {
    mockGetContainerLogs.mockResolvedValue('Some log lines here with enough content.');

    mockChatStream.mockRejectedValue(new Error('LLM unavailable'));

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);
    expect(result).toBeNull();
  });

  it('respects max containers limit', async () => {
    mockGetContainerLogs.mockResolvedValue(
      '2024-01-01T00:00:00Z ERROR: Something failed\n'.repeat(5),
    );
    mockChatStream.mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk(JSON.stringify({ severity: 'warning', summary: 'Issues found', errorPatterns: [] }));
      return Promise.resolve('');
    });

    const containers = Array.from({ length: 10 }, (_, i) => ({
      endpointId: 1,
      containerId: `container-${i}`,
      containerName: `app-${i}`,
    }));

    const results = await analyzeLogsForContainers(containers, 2, 100);

    // Should only call for first 2 containers
    expect(mockGetContainerLogs).toHaveBeenCalledTimes(2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('handles malformed JSON from LLM gracefully', async () => {
    mockGetContainerLogs.mockResolvedValue('ERROR: Something broke\n'.repeat(5));

    mockChatStream.mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk('This is not valid JSON at all');
      return Promise.resolve('');
    });

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);
    expect(result).toBeNull();
  });

  it('sanitizes control characters in LLM JSON output (#744)', async () => {
    mockGetContainerLogs.mockResolvedValue('ERROR: Something broke\n'.repeat(5));

    // Simulate LLM echoing raw tabs and carriage returns from log content
    const jsonWithControlChars =
      '{"severity":"warning","summary":"Database\tconnection\rfailures","errorPatterns":["timeout\x00error"]}';

    mockChatStream.mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk(jsonWithControlChars);
      return Promise.resolve('');
    });

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe('warning');
    expect(result!.summary).toContain('Database');
    expect(result!.summary).toContain('connection');
    expect(result!.errorPatterns[0]).toContain('timeout');
  });

  it('handles JSON with embedded newline-heavy control chars (#744)', async () => {
    mockGetContainerLogs.mockResolvedValue('ERROR: Something broke\n'.repeat(5));

    // Simulate LLM output with null bytes, form feeds, backspace, and vertical tabs
    const jsonWithBadChars =
      '{"severity":"critical","summary":"OOM\x0b\x0ckilled\x08","errorPatterns":[]}';

    mockChatStream.mockImplementation((_msgs: unknown, _sys: unknown, onChunk: (s: string) => void) => {
      onChunk(jsonWithBadChars);
      return Promise.resolve('');
    });

    const result = await analyzeContainerLogs(1, 'container-1', 'web-app', 100);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe('critical');
    expect(result!.summary).toContain('OOM');
  });
});
