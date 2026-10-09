import { describe, it, expect, vi } from 'vitest';
import { runMain } from '../startup.js';

function makeLog() {
  return { fatal: vi.fn() };
}

describe('runMain (#1702)', () => {
  it('logs fatal and exits 1 when startup rejects before listen', async () => {
    const log = makeLog();
    const exit = vi.fn();
    const err = new Error('JWT_SECRET must be at least 32 characters in production');

    await runMain(() => Promise.reject(err), exit, log);

    expect(log.fatal).toHaveBeenCalledWith({ err }, 'Failed to start server');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when startup throws synchronously', async () => {
    const log = makeLog();
    const exit = vi.fn();

    await runMain(() => {
      throw new Error('boom');
    }, exit, log);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not exit when startup succeeds', async () => {
    const log = makeLog();
    const exit = vi.fn();

    await runMain(async () => {}, exit, log);

    expect(exit).not.toHaveBeenCalled();
    expect(log.fatal).not.toHaveBeenCalled();
  });
});
