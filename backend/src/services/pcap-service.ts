import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import {
  createExec,
  startExec,
  inspectExec,
  getArchive,
} from './portainer-client.js';
import {
  insertCapture,
  updateCaptureStatus,
  getCapture,
  getCaptures,
  getCapturesCount,
  deleteCapture as deleteDbCapture,
  cleanOldCaptures as cleanDbOldCaptures,
} from './pcap-store.js';
import type { StartCaptureRequest, Capture, CaptureStatus } from '../models/pcap.js';

const log = createChildLogger('pcap-service');

// In-memory tracking of polling intervals for active captures
const activeCaptures = new Map<string, NodeJS.Timeout>();

const POLL_INTERVAL_MS = 2000;

function getStorageDir(): string {
  const config = getConfig();
  const dir = config.PCAP_STORAGE_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function buildTcpdumpCommand(
  captureId: string,
  filter?: string,
  durationSeconds?: number,
  maxPackets?: number,
): string[] {
  // Build the tcpdump args portion
  let tcpdumpArgs = `-i any -w /tmp/capture_${captureId}.pcap -U`;

  if (maxPackets) {
    tcpdumpArgs += ` -c ${maxPackets}`;
  }

  if (filter) {
    tcpdumpArgs += ` ${filter}`;
  }

  // Wrap in sh -c to auto-install tcpdump if missing.
  // Tries common package managers (apk for Alpine, apt for Debian/Ubuntu, yum for RHEL/CentOS).
  const install = 'command -v tcpdump >/dev/null 2>&1 || ' +
    'apk add --no-cache tcpdump 2>/dev/null || ' +
    '(apt-get update -qq && apt-get install -y -qq tcpdump) 2>/dev/null || ' +
    'yum install -y tcpdump 2>/dev/null || ' +
    '{ echo "Failed to install tcpdump" >&2; exit 1; }';
  const script = `${install} && exec tcpdump ${tcpdumpArgs}`;

  return ['sh', '-c', script];
}

export function extractFromTar(tarBuffer: Buffer): Buffer | null {
  // Minimal tar parser: tar files consist of 512-byte blocks
  // Header block (512 bytes) followed by file data blocks
  if (tarBuffer.length < 512) return null;

  // File size is at offset 124, 12 bytes, octal string
  const sizeStr = tarBuffer.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim();
  const fileSize = parseInt(sizeStr, 8);

  if (isNaN(fileSize) || fileSize <= 0) return null;
  if (tarBuffer.length < 512 + fileSize) return null;

  return tarBuffer.subarray(512, 512 + fileSize);
}

export async function startCapture(params: StartCaptureRequest): Promise<Capture> {
  const config = getConfig();

  // Guard: feature flag
  if (!config.PCAP_ENABLED) {
    throw new Error('Packet capture is not enabled. Set PCAP_ENABLED=true to enable.');
  }

  // Guard: concurrency
  const activeCount = await getActiveCount();
  if (activeCount >= config.PCAP_MAX_CONCURRENT) {
    throw new Error(
      `Concurrency limit reached: ${activeCount}/${config.PCAP_MAX_CONCURRENT} captures active`,
    );
  }

  // Enforce max duration from config
  const duration = params.durationSeconds
    ? Math.min(params.durationSeconds, config.PCAP_MAX_DURATION_SECONDS)
    : config.PCAP_MAX_DURATION_SECONDS;

  const captureId = uuidv4();

  // Insert DB record
  await insertCapture({
    id: captureId,
    endpoint_id: params.endpointId,
    container_id: params.containerId,
    container_name: params.containerName,
    filter: params.filter,
    duration_seconds: duration,
    max_packets: params.maxPackets,
  });

  try {
    // Build tcpdump command
    const cmd = buildTcpdumpCommand(captureId, params.filter, duration, params.maxPackets);

    // Create and start exec (root required for NET_RAW capability)
    const exec = await createExec(params.endpointId, params.containerId, cmd, { user: 'root' });
    await startExec(params.endpointId, exec.Id);

    // Update status to capturing
    await updateCaptureStatus(captureId, 'capturing', {
      exec_id: exec.Id,
      started_at: new Date().toISOString(),
    });

    // Start polling
    startPolling(captureId, params.endpointId, params.containerId, exec.Id, duration);

    log.info(
      { captureId, containerId: params.containerId, filter: params.filter, duration },
      'Packet capture started',
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to start capture';
    await updateCaptureStatus(captureId, 'failed', {
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
    log.error({ captureId, err }, 'Failed to start capture');
    throw err;
  }

  return (await getCapture(captureId))!;
}

function startPolling(
  captureId: string,
  endpointId: number,
  containerId: string,
  execId: string,
  durationSeconds: number,
): void {
  const startTime = Date.now();
  const maxDurationMs = durationSeconds * 1000;

  const interval = setInterval(async () => {
    try {
      const elapsed = Date.now() - startTime;

      // Check duration limit
      if (elapsed >= maxDurationMs) {
        log.info({ captureId }, 'Capture duration limit reached, stopping');
        clearInterval(interval);
        activeCaptures.delete(captureId);
        await stopCaptureInternal(captureId, endpointId, containerId);
        return;
      }

      // Poll exec status
      const execInfo = await inspectExec(endpointId, execId);

      if (!execInfo.Running) {
        clearInterval(interval);
        activeCaptures.delete(captureId);

        if (execInfo.ExitCode === 0 || execInfo.ExitCode === 137) {
          // 0 = normal exit (e.g., max packets reached), 137 = killed (our stop signal)
          await downloadAndProcessCapture(captureId, endpointId, containerId);
        } else {
          await updateCaptureStatus(captureId, 'failed', {
            error_message: `tcpdump exited with code ${execInfo.ExitCode}`,
            completed_at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      log.warn({ captureId, err }, 'Error polling capture status');
      // Don't stop polling on transient errors
    }
  }, POLL_INTERVAL_MS);

  activeCaptures.set(captureId, interval);
}

async function downloadAndProcessCapture(
  captureId: string,
  endpointId: number,
  containerId: string,
): Promise<void> {
  await updateCaptureStatus(captureId, 'processing');

  try {
    const config = getConfig();
    const containerPath = `/tmp/capture_${captureId}.pcap`;
    const tarBuffer = await getArchive(endpointId, containerId, containerPath);

    // Extract PCAP from tar
    const pcapData = extractFromTar(tarBuffer);
    if (!pcapData) {
      await updateCaptureStatus(captureId, 'failed', {
        error_message: 'Failed to extract PCAP data from archive',
        completed_at: new Date().toISOString(),
      });
      return;
    }

    // Check file size
    const maxSizeBytes = config.PCAP_MAX_FILE_SIZE_MB * 1024 * 1024;
    if (pcapData.length > maxSizeBytes) {
      await updateCaptureStatus(captureId, 'failed', {
        error_message: `Capture file exceeds maximum size of ${config.PCAP_MAX_FILE_SIZE_MB}MB`,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    // Write to storage
    const storageDir = getStorageDir();
    const filename = `capture_${captureId}.pcap`;
    const filePath = path.join(storageDir, filename);
    fs.writeFileSync(filePath, pcapData);

    await updateCaptureStatus(captureId, 'complete', {
      capture_file: filename,
      file_size_bytes: pcapData.length,
      completed_at: new Date().toISOString(),
    });

    log.info({ captureId, fileSize: pcapData.length }, 'Capture file saved');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to download capture';
    await updateCaptureStatus(captureId, 'failed', {
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
    log.error({ captureId, err }, 'Failed to download/process capture');
  }
}

async function stopCaptureInternal(
  captureId: string,
  endpointId: number,
  containerId: string,
): Promise<void> {
  try {
    // Send pkill to stop tcpdump (root to match the capture process)
    const killExec = await createExec(endpointId, containerId, [
      'pkill', '-f', `capture_${captureId}`,
    ], { user: 'root' });
    await startExec(endpointId, killExec.Id);

    // Wait a moment for tcpdump to flush
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try to download the partial capture
    await downloadAndProcessCapture(captureId, endpointId, containerId);

    // If it completed, override status to 'succeeded' to indicate manual stop
    const capture = await getCapture(captureId);
    if (capture && capture.status === 'complete') {
      await updateCaptureStatus(captureId, 'succeeded');
    }
  } catch (err) {
    await updateCaptureStatus(captureId, 'succeeded', {
      error_message: 'Stopped (partial data may be unavailable)',
      completed_at: new Date().toISOString(),
    });
    log.warn({ captureId, err }, 'Error during capture stop');
  }
}

export async function stopCapture(id: string): Promise<Capture> {
  const capture = await getCapture(id);
  if (!capture) {
    throw new Error('Capture not found');
  }

  if (capture.status !== 'capturing' && capture.status !== 'pending') {
    throw new Error(`Cannot stop capture in status: ${capture.status}`);
  }

  // Clear polling
  const interval = activeCaptures.get(id);
  if (interval) {
    clearInterval(interval);
    activeCaptures.delete(id);
  }

  await stopCaptureInternal(id, capture.endpoint_id, capture.container_id);

  return (await getCapture(id))!;
}

export async function getCaptureById(id: string): Promise<Capture | undefined> {
  return getCapture(id);
}

export async function listCaptures(options?: {
  status?: CaptureStatus;
  containerId?: string;
  limit?: number;
  offset?: number;
}): Promise<Capture[]> {
  return getCaptures(options);
}

export async function deleteCaptureById(id: string): Promise<void> {
  const capture = await getCapture(id);
  if (!capture) {
    throw new Error('Capture not found');
  }

  // Can't delete active captures
  if (capture.status === 'capturing' || capture.status === 'processing') {
    throw new Error('Cannot delete an active capture. Stop it first.');
  }

  // Delete file if exists
  if (capture.capture_file) {
    try {
      const storageDir = getStorageDir();
      const filePath = path.join(storageDir, capture.capture_file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      log.warn({ captureId: id, err }, 'Failed to delete capture file');
    }
  }

  await deleteDbCapture(id);
}

export async function getCaptureFilePath(id: string): Promise<string | null> {
  const capture = await getCapture(id);
  if (!capture || !capture.capture_file) return null;

  const config = getConfig();
  const storageDir = path.resolve(config.PCAP_STORAGE_DIR);
  const filePath = path.resolve(path.join(storageDir, capture.capture_file));

  // Path traversal check
  if (!filePath.startsWith(storageDir)) {
    log.warn({ captureId: id, filePath, storageDir }, 'Path traversal attempt detected');
    return null;
  }

  if (!fs.existsSync(filePath)) return null;

  return filePath;
}

export async function cleanupOldCaptures(): Promise<void> {
  const config = getConfig();
  const storageDir = getStorageDir();

  // Get captures that will be cleaned — query the files before deleting DB records
  const [completeCaptures, failedCaptures, succeededCaptures] = await Promise.all([
    getCaptures({ status: 'complete' }),
    getCaptures({ status: 'failed' }),
    getCaptures({ status: 'succeeded' }),
  ]);
  const oldCaptures = completeCaptures
    .concat(failedCaptures)
    .concat(succeededCaptures)
    .filter((c) => {
      if (!c.created_at) return false;
      const createdAt = new Date(c.created_at).getTime();
      const cutoff = Date.now() - config.PCAP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      return createdAt < cutoff;
    });

  // Delete files
  for (const capture of oldCaptures) {
    if (capture.capture_file) {
      try {
        const filePath = path.join(storageDir, capture.capture_file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        log.warn({ file: capture.capture_file, err }, 'Failed to delete old capture file');
      }
    }
  }

  // Clean DB records
  await cleanDbOldCaptures(config.PCAP_RETENTION_DAYS);
}

async function getActiveCount(): Promise<number> {
  const [capturing, pending] = await Promise.all([
    getCapturesCount('capturing'),
    getCapturesCount('pending'),
  ]);
  return capturing + pending;
}

export async function getActiveCaptures(): Promise<Capture[]> {
  const [capturing, pending, processing] = await Promise.all([
    getCaptures({ status: 'capturing' }),
    getCaptures({ status: 'pending' }),
    getCaptures({ status: 'processing' }),
  ]);
  return [...capturing, ...pending, ...processing];
}
