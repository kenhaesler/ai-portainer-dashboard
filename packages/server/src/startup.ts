import { createChildLogger } from '@dashboard/core/utils/logger.js';

type FatalLogger = { fatal: (obj: object, msg: string) => void };

/**
 * Runs the server bootstrap and turns any startup failure into a hard,
 * non-zero exit. Without this, a rejection from getConfig() (weak
 * JWT_SECRET), a failing migration or buildApp() only reached the
 * `unhandledRejection` handler, which logs and keeps the process alive (#1702).
 * Kept separate from index.ts so it is testable without booting the app.
 */
export async function runMain(
  main: () => Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
  log: FatalLogger = createChildLogger('server'),
): Promise<void> {
  try {
    await main();
  } catch (err) {
    log.fatal({ err }, 'Failed to start server');
    exit(1);
  }
}
