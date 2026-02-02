import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/index.js';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('backup-service');

function getBackupsDir(): string {
  const config = getConfig();
  const dbDir = path.dirname(config.SQLITE_PATH);
  const backupsDir = path.join(dbDir, 'backups');

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  return backupsDir;
}

export function createBackup(): string {
  const config = getConfig();
  const db = getDb();
  const backupsDir = getBackupsDir();

  // Checkpoint WAL to ensure all data is in the main DB file
  db.pragma('wal_checkpoint(TRUNCATE)');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `dashboard-backup-${timestamp}.db`;
  const destPath = path.join(backupsDir, filename);

  fs.copyFileSync(config.SQLITE_PATH, destPath);

  log.info({ filename, destPath }, 'Database backup created');
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
    .filter((f) => f.endsWith('.db'))
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

export function restoreBackup(filename: string): void {
  const config = getConfig();
  const backupPath = getBackupPath(filename);

  // WARNING: This is a destructive operation. The database will be replaced.
  // The application should be restarted after restore.
  log.warn({ filename, target: config.SQLITE_PATH }, 'Restoring database from backup - RESTART REQUIRED');

  fs.copyFileSync(backupPath, config.SQLITE_PATH);

  log.info({ filename }, 'Database restored from backup. Please restart the application.');
}
