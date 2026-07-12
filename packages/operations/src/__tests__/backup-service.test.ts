import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * backup-service unit tests (#1522). The true external boundary is child_process
 * .execFile (pg_dump / pg_restore); the service itself is internal logic —
 * argv/env construction from POSTGRES_APP_URL and the CWE-22 path guard — that
 * had zero coverage. We stub execFile and assert the exact argv/env, and drive
 * getBackupPath/deleteBackup against a real temp dir (process.cwd() redirected).
 */

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockGetConfig = vi.fn();
vi.mock('@dashboard/core/config/index.js', () => ({
  getConfig: () => mockGetConfig(),
}));

import {
  createBackup,
  restoreBackup,
  getBackupPath,
  deleteBackup,
  listBackups,
} from '../services/backup-service.js';

let tmpDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

function backupsDir(): string {
  return path.join(tmpDir, 'data', 'backups');
}

beforeEach(() => {
  vi.clearAllMocks();
  // promisify(execFile) invokes execFile(file, args, options, callback); resolve it.
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      cb(null, { stdout: '', stderr: '' });
    },
  );
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-svc-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  mockGetConfig.mockReturnValue({
    POSTGRES_APP_URL: 'postgresql://app_user:changeme-postgres-app@localhost:5432/portainer_dashboard',
  });
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('backup-service (#1522)', () => {
  describe('createBackup — pg_dump argv + PGPASSWORD from POSTGRES_APP_URL', () => {
    it('builds the pg_dump argv and passes the password via PGPASSWORD env', async () => {
      mockGetConfig.mockReturnValue({
        POSTGRES_APP_URL: 'postgresql://app_user:changeme-postgres-app@db-host:6544/portainer_dashboard',
      });

      const filename = await createBackup();
      expect(filename).toMatch(/^dashboard-backup-.*\.dump$/);
      expect(mockExecFile).toHaveBeenCalledTimes(1);

      const [cmd, args, opts] = mockExecFile.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
      expect(cmd).toBe('pg_dump');
      expect(args).toEqual([
        '-h', 'db-host',
        '-p', '6544',
        '-U', 'app_user',
        '-d', 'portainer_dashboard',
        '--format=custom',
        '--file', path.join(backupsDir(), filename),
      ]);
      expect(opts.env.PGPASSWORD).toBe('changeme-postgres-app');
    });

    it('defaults the port to 5432 when the URL omits one', async () => {
      mockGetConfig.mockReturnValue({
        POSTGRES_APP_URL: 'postgresql://app_user:pw@dbhost/portainer_dashboard',
      });

      await createBackup();
      const [, args] = mockExecFile.mock.calls[0] as [string, string[], unknown];
      expect(args[args.indexOf('-p') + 1]).toBe('5432');
    });

    it('URL-decodes a percent-encoded password and a non-default db name', async () => {
      // p@ss:w/rd → p%40ss%3Aw%2Frd
      mockGetConfig.mockReturnValue({
        POSTGRES_APP_URL: 'postgresql://app_user:p%40ss%3Aw%2Frd@dbhost:5432/app_db',
      });

      await createBackup();
      const [, args, opts] = mockExecFile.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
      expect(args[args.indexOf('-d') + 1]).toBe('app_db');
      expect(opts.env.PGPASSWORD).toBe('p@ss:w/rd');
    });
  });

  describe('restoreBackup — pg_restore with --clean --if-exists', () => {
    it('runs pg_restore with the destructive flags against the resolved backup path', async () => {
      const file = 'dashboard-backup-x.dump';
      fs.mkdirSync(backupsDir(), { recursive: true });
      fs.writeFileSync(path.join(backupsDir(), file), 'dump');
      mockGetConfig.mockReturnValue({
        POSTGRES_APP_URL: 'postgresql://app_user:pw@dbhost:5432/portainer_dashboard',
      });

      await restoreBackup(file);
      const [cmd, args] = mockExecFile.mock.calls[0] as [string, string[], unknown];
      expect(cmd).toBe('pg_restore');
      expect(args).toEqual([
        '-h', 'dbhost',
        '-p', '5432',
        '-U', 'app_user',
        '-d', 'portainer_dashboard',
        '--clean',
        '--if-exists',
        path.join(backupsDir(), file),
      ]);
    });
  });

  describe('getBackupPath / deleteBackup — path handling + CWE-22 guard', () => {
    it('resolves an existing backup by filename', () => {
      fs.mkdirSync(backupsDir(), { recursive: true });
      fs.writeFileSync(path.join(backupsDir(), 'ok.dump'), 'x');
      expect(getBackupPath('ok.dump')).toBe(path.join(backupsDir(), 'ok.dump'));
    });

    it('translates a traversal filename into a path-traversal error', () => {
      fs.mkdirSync(backupsDir(), { recursive: true });
      expect(() => getBackupPath('../../etc/passwd')).toThrow(/path traversal detected/);
    });

    it('throws "Backup not found" for a safe but missing filename', () => {
      fs.mkdirSync(backupsDir(), { recursive: true });
      expect(() => getBackupPath('missing.dump')).toThrow(/Backup not found/);
    });

    it('deleteBackup removes the resolved file', () => {
      fs.mkdirSync(backupsDir(), { recursive: true });
      const target = path.join(backupsDir(), 'gone.dump');
      fs.writeFileSync(target, 'x');
      deleteBackup('gone.dump');
      expect(fs.existsSync(target)).toBe(false);
    });

    it('refuses to delete a traversal path (guard shared with getBackupPath)', () => {
      fs.mkdirSync(backupsDir(), { recursive: true });
      expect(() => deleteBackup('../../secret')).toThrow(/path traversal detected/);
    });
  });

  describe('listBackups', () => {
    it('lists .dump files newest-first and ignores non-dump files', () => {
      fs.mkdirSync(backupsDir(), { recursive: true });
      fs.writeFileSync(path.join(backupsDir(), 'a.dump'), 'x');
      fs.writeFileSync(path.join(backupsDir(), 'b.dump'), 'x');
      fs.writeFileSync(path.join(backupsDir(), 'notes.txt'), 'x');
      expect(listBackups().map((b) => b.filename)).toEqual(['b.dump', 'a.dump']);
    });
  });
});
