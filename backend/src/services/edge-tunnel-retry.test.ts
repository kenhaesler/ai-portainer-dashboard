import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isDockerProxyUnavailable,
  getContainerLogsWithRetry,
  waitForTunnel,
} from './edge-log-fetcher.js';

import * as portainer from '../core/portainer/portainer-client.js';

describe('isDockerProxyUnavailable', () => {
  it('returns true for status 502', () => {
    expect(isDockerProxyUnavailable({ status: 502 })).toBe(true);
  });

  it('returns true for status 404', () => {
    expect(isDockerProxyUnavailable({ status: 404 })).toBe(true);
  });

  it('returns true for status 503', () => {
    expect(isDockerProxyUnavailable({ status: 503 })).toBe(true);
  });

  it('returns false for status 500', () => {
    expect(isDockerProxyUnavailable({ status: 500 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDockerProxyUnavailable(null)).toBe(false);
  });

  it('returns false for error without status', () => {
    expect(isDockerProxyUnavailable(new Error('fail'))).toBe(false);
  });
});

describe('getContainerLogsWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns logs on first try when tunnel is up', async () => {
    vi.spyOn(portainer, 'getContainerLogs').mockResolvedValue('log line 1\nlog line 2');

    const result = await getContainerLogsWithRetry(1, 'abc', { tail: 100 });
    expect(result).toBe('log line 1\nlog line 2');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(1);
  });

  it('retries after tunnel warm-up on 502', async () => {
    const proxyErr = Object.assign(new Error('Bad Gateway'), { status: 502 });
    vi.spyOn(portainer, 'getContainerLogs')
      .mockRejectedValueOnce(proxyErr)
      .mockResolvedValueOnce('retry logs');
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    const result = await getContainerLogsWithRetry(4, 'def', { tail: 50 }, { maxWaitMs: 100 });
    expect(result).toBe('retry logs');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(2);
    expect(portainer.getContainers).toHaveBeenCalledWith(4, false);
  });

  it('throws non-proxy errors directly', async () => {
    const authErr = Object.assign(new Error('Unauthorized'), { status: 401 });
    vi.spyOn(portainer, 'getContainerLogs').mockRejectedValue(authErr);
    const getContainersSpy = vi.spyOn(portainer, 'getContainers');

    await expect(
      getContainerLogsWithRetry(1, 'abc', { tail: 100 }),
    ).rejects.toThrow('Unauthorized');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(1);
    expect(getContainersSpy).not.toHaveBeenCalled();
  });

  it('retries after tunnel warm-up on 404', async () => {
    const notFoundErr = Object.assign(new Error('Not Found'), { status: 404 });
    vi.spyOn(portainer, 'getContainerLogs')
      .mockRejectedValueOnce(notFoundErr)
      .mockResolvedValueOnce('found after warmup');
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    const result = await getContainerLogsWithRetry(4, 'ghi', { tail: 50 }, { maxWaitMs: 100 });
    expect(result).toBe('found after warmup');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(2);
  });

  it('throws tunnel timeout when warmup fails', async () => {
    const proxyErr = Object.assign(new Error('Bad Gateway'), { status: 502 });
    vi.spyOn(portainer, 'getContainerLogs').mockRejectedValue(proxyErr);
    vi.spyOn(portainer, 'getContainers').mockRejectedValue(new Error('tunnel not ready'));

    await expect(
      getContainerLogsWithRetry(4, 'xyz', { tail: 50 }, { maxWaitMs: 100, pollIntervalMs: 50 }),
    ).rejects.toThrow('tunnel did not establish');
  });
});

describe('waitForTunnel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when tunnel is already up', async () => {
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);
    const promise = waitForTunnel(4, { maxWaitMs: 5000, pollIntervalMs: 1000, stabilizationMs: 0 });
    await promise;
    expect(portainer.getContainers).toHaveBeenCalledTimes(1);
  });

  it('resolves with stabilization delay when tunnel is already up', async () => {
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);
    const promise = waitForTunnel(4, { maxWaitMs: 5000, pollIntervalMs: 1000, stabilizationMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(portainer.getContainers).toHaveBeenCalledTimes(1);
  });

  it('polls until tunnel establishes', async () => {
    vi.spyOn(portainer, 'getContainers')
      .mockRejectedValueOnce(new Error('not ready'))
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce([]);

    const promise = waitForTunnel(4, { maxWaitMs: 10000, pollIntervalMs: 1000, stabilizationMs: 0 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(portainer.getContainers).toHaveBeenCalledTimes(3);
  });

  it('throws after timeout', async () => {
    vi.spyOn(portainer, 'getContainers').mockRejectedValue(new Error('not ready'));

    let caughtError: Error | undefined;
    const promise = waitForTunnel(4, { maxWaitMs: 3000, pollIntervalMs: 1000, stabilizationMs: 0 }).catch((err) => {
      caughtError = err;
    });

    await vi.advanceTimersByTimeAsync(4000);
    await promise;

    expect(caughtError!.message).toContain('tunnel did not establish');
    expect((caughtError as any).status).toBe(504);
  });
});
