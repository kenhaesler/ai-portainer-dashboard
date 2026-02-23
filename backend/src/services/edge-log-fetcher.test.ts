import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDockerProxyUnavailable, waitForTunnel, getContainerLogsWithRetry } from './edge-log-fetcher.js';

import * as portainer from '../core/portainer/portainer-client.js';

describe('isDockerProxyUnavailable', () => {
  it('returns true for status 502', () => {
    expect(isDockerProxyUnavailable({ status: 502 })).toBe(true);
  });

  it('returns true for status 503', () => {
    expect(isDockerProxyUnavailable({ status: 503 })).toBe(true);
  });

  it('returns true for status 404', () => {
    expect(isDockerProxyUnavailable({ status: 404 })).toBe(true);
  });

  it('returns false for status 401', () => {
    expect(isDockerProxyUnavailable({ status: 401 })).toBe(false);
  });

  it('returns false for status 200', () => {
    expect(isDockerProxyUnavailable({ status: 200 })).toBe(false);
  });

  it('returns false for non-object errors', () => {
    expect(isDockerProxyUnavailable('error string')).toBe(false);
    expect(isDockerProxyUnavailable(null)).toBe(false);
    expect(isDockerProxyUnavailable(undefined)).toBe(false);
  });

  it('returns false for objects without status', () => {
    expect(isDockerProxyUnavailable({ message: 'error' })).toBe(false);
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

  it('returns immediately when tunnel is already established', async () => {
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    const promise = waitForTunnel(20, { stabilizationMs: 0 });
    await vi.runAllTimersAsync();
    await promise;

    expect(portainer.getContainers).toHaveBeenCalledWith(20, false);
  });

  it('polls until tunnel is established', async () => {
    vi.spyOn(portainer, 'getContainers')
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([]);

    const promise = waitForTunnel(20, { pollIntervalMs: 500, stabilizationMs: 0 });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(portainer.getContainers).toHaveBeenCalledTimes(2);
  });

  it('applies stabilization delay after tunnel confirmation', async () => {
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    const promise = waitForTunnel(20, { stabilizationMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(portainer.getContainers).toHaveBeenCalledTimes(1);
  });

  it('throws 504 when tunnel does not establish within timeout', async () => {
    vi.spyOn(portainer, 'getContainers').mockRejectedValue(new Error('unavailable'));

    // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
    const promise = waitForTunnel(20, { maxWaitMs: 3000, pollIntervalMs: 1000, stabilizationMs: 0 })
      .then(() => { throw new Error('should have thrown'); })
      .catch((err: any) => err);

    await vi.advanceTimersByTimeAsync(4000);

    const err = await promise;
    expect(err.message).toBe('Edge agent tunnel did not establish within timeout');
    expect(err.status).toBe(504);
  });
});

describe('getContainerLogsWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns logs on first attempt when no error', async () => {
    vi.spyOn(portainer, 'getContainerLogs').mockResolvedValue('log output');

    const result = await getContainerLogsWithRetry(1, 'abc123');

    expect(result).toBe('log output');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(1);
  });

  it('retries with tunnel warm-up on proxy unavailable error', async () => {
    vi.spyOn(portainer, 'getContainerLogs')
      .mockRejectedValueOnce({ status: 502, message: 'proxy error' })
      .mockResolvedValueOnce('log output after retry');

    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    const promise = getContainerLogsWithRetry(20, 'abc123', {}, { maxWaitMs: 500 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('log output after retry');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(2);
    expect(portainer.getContainers).toHaveBeenCalled();
  });

  it('retries up to 3 times with backoff', async () => {
    const proxyError = { status: 404, message: 'not found' };
    vi.spyOn(portainer, 'getContainerLogs')
      .mockRejectedValueOnce(proxyError)
      .mockRejectedValueOnce(proxyError)
      .mockResolvedValueOnce('log output on third attempt');

    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    const promise = getContainerLogsWithRetry(20, 'abc123', {}, { maxWaitMs: 500 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('log output on third attempt');
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(3);
  });

  it('throws immediately for non-proxy errors (e.g., auth)', async () => {
    vi.spyOn(portainer, 'getContainerLogs').mockRejectedValue({ status: 401, message: 'Unauthorized' });
    const getContainersSpy = vi.spyOn(portainer, 'getContainers');

    await expect(getContainerLogsWithRetry(1, 'abc123')).rejects.toMatchObject({
      status: 401,
    });
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(1);
    expect(getContainersSpy).not.toHaveBeenCalled();
  });

  it('throws after exhausting all retries', async () => {
    const proxyError = { status: 502, message: 'proxy error' };
    vi.spyOn(portainer, 'getContainerLogs').mockRejectedValue(proxyError);
    vi.spyOn(portainer, 'getContainers').mockResolvedValue([]);

    // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
    const promise = getContainerLogsWithRetry(20, 'abc123', {}, { maxWaitMs: 500 })
      .then(() => { throw new Error('should have thrown'); })
      .catch((err: any) => err);

    await vi.runAllTimersAsync();

    const err = await promise;
    expect(err.status).toBe(502);
    expect(portainer.getContainerLogs).toHaveBeenCalledTimes(3);
  });
});
