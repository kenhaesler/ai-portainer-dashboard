import fs from 'fs';
import path from 'path';
import { Agent } from 'undici';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { safePath, PathTraversalError } from '@dashboard/core/utils/safe-path.js';

const log = createChildLogger('portainer-backup');

let unsafeDispatcher: Agent | undefined;
function getDispatcher(): Agent | undefined {
  const config = getConfig();
  if (config.PORTAINER_VERIFY_SSL) return undefined;
  if (!unsafeDispatcher) {
    // nosemgrep: bypass-tls-verification — intentional: admin-configurable SSL verification bypass
    unsafeDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return unsafeDispatcher;
}

function getBackupsDir(): string {
  const backupsDir = path.resolve('./data/portainer-backups');

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  return backupsDir;
}

export interface PortainerBackupInfo {
  filename: string;
  size: number;
  createdAt: string;
}

export async function createPortainerBackup(password?: string): Promise<{ filename: string; size: number }> {
  const config = getConfig();
  const url = `${config.PORTAINER_API_URL}/api/backup`;

  const headers: Record<string, string> = {};
  if (config.PORTAINER_API_KEY) {
    headers['X-API-Key'] = config.PORTAINER_API_KEY;
  }
  headers['Content-Type'] = 'application/json';

  const body = password ? JSON.stringify({ password }) : JSON.stringify({});

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      dispatcher: getDispatcher(),
    } as RequestInit);
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Portainer backup failed: HTTP ${res.status} ${text}`);
    }

    // Parse filename from Content-Disposition header or generate one
    const disposition = res.headers.get('content-disposition');
    let filename: string;
    if (disposition) {
      const match = disposition.match(/filename="?([^";\s]+)"?/);
      filename = match?.[1] ?? `portainer-backup-${Date.now()}.tar.gz`;
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `portainer-backup-${timestamp}.tar.gz`;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // CWE-22 fix: validate filename from Content-Disposition stays inside backups dir
    const backupsDir = getBackupsDir();
    const destPath = safePath(backupsDir, filename);
    fs.writeFileSync(destPath, buffer);

    log.info({ filename, size: buffer.length }, 'Portainer backup created');
    return { filename, size: buffer.length };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export function listPortainerBackups(): PortainerBackupInfo[] {
  const backupsDir = getBackupsDir();

  const files = fs.readdirSync(backupsDir)
    .filter((f) => f.includes('.tar.gz'))
    .sort()
    .reverse();

  return files.map((filename) => {
    // Defense-in-depth: filenames from readdirSync are trusted but validate anyway
    const filePath = safePath(backupsDir, filename);
    const stat = fs.statSync(filePath);
    return {
      filename,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  });
}

export function getPortainerBackupPath(filename: string): string {
  const backupsDir = getBackupsDir();

  // CWE-22 fix: replaces ad-hoc startsWith check (which lacked path.sep suffix)
  let resolved: string;
  try {
    resolved = safePath(backupsDir, filename);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw new Error('Invalid backup filename: path traversal detected');
    }
    throw err;
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Portainer backup not found: ${filename}`);
  }

  return resolved;
}

export function deletePortainerBackup(filename: string): void {
  const filePath = getPortainerBackupPath(filename);
  fs.unlinkSync(filePath);
  log.info({ filename }, 'Portainer backup deleted');
}

export function cleanupOldPortainerBackups(maxCount: number): number {
  const backups = listPortainerBackups();
  if (backups.length <= maxCount) return 0;

  const toDelete = backups.slice(maxCount);
  let deleted = 0;
  for (const backup of toDelete) {
    try {
      // Defense-in-depth: validate even though filenames came from readdirSync
      const backupsDir = getBackupsDir();
      const filePath = safePath(backupsDir, backup.filename);
      fs.unlinkSync(filePath);
      deleted++;
      log.info({ filename: backup.filename }, 'Old Portainer backup cleaned up');
    } catch (err) {
      log.warn({ filename: backup.filename, err }, 'Failed to delete old Portainer backup');
    }
  }

  return deleted;
}
