import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getConfig } from '../core/config/index.js';
import { createChildLogger } from '../core/utils/logger.js';

const execFileAsync = promisify(execFile);
const log = createChildLogger('backup-service');

function getBackupsDir(): string {
  const backupsDir = path.join(process.cwd(), 'data', 'backups');

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  return backupsDir;
}

export async function createBackup(): Promise<string> {
  const config = getConfig();
  const url = new URL(config.POSTGRES_APP_URL);
  const backupsDir = getBackupsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `dashboard-backup-${timestamp}.dump`;
  const destPath = path.join(backupsDir, filename);

  await execFileAsync('pg_dump', [
    '-h', url.hostname,
    '-p', url.port || '5432',
    '-U', url.username,
    '-d', url.pathname.slice(1),
    '--format=custom',
    '--file', destPath,
  ], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    timeout: 60_000,
  });

  log.info({ filename }, 'Database backup created');
  return filename;
}

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
}

export function listBackups(): BackupInfo[] {
  const backupsDir = getBackupsDir();

  const files = fs.readdirSync(backupsDir)
    .filter((f) => f.endsWith('.dump'))
    .sort()
    .reverse();

  return files.map((filename) => {
    const filePath = path.join(backupsDir, filename);
    const stat = fs.statSync(filePath);
    return {
      filename,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  });
}

export function getBackupPath(filename: string): string {
  const backupsDir = getBackupsDir();
  const filePath = path.join(backupsDir, filename);

  // Security: ensure the resolved path is within backups directory
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(backupsDir))) {
    throw new Error('Invalid backup filename: path traversal detected');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Backup not found: ${filename}`);
  }

  return resolved;
}

export function deleteBackup(filename: string): void {
  const filePath = getBackupPath(filename);
  fs.unlinkSync(filePath);
  log.info({ filename }, 'Backup deleted');
}

export async function restoreBackup(filename: string): Promise<void> {
  const config = getConfig();
  const url = new URL(config.POSTGRES_APP_URL);
  const backupPath = getBackupPath(filename);

  await execFileAsync('pg_restore', [
    '-h', url.hostname,
    '-p', url.port || '5432',
    '-U', url.username,
    '-d', url.pathname.slice(1),
    '--clean',
    '--if-exists',
    backupPath,
  ], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    timeout: 120_000,
  });

  log.info({ filename }, 'Database restored from backup');
}
