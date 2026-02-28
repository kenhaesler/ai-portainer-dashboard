import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { safePath, PathTraversalError } from '@dashboard/core/utils/safe-path.js';
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  getContainer,
  getArchive,
  pullImage,
  getImages,
  getContainers,
} from '@dashboard/core/portainer/portainer-client.js';
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

/**
 * Build the command for the sidecar capture container.
 * If the image is Alpine (the default), installs tcpdump on the fly.
 * If a custom image with tcpdump is used, the install step is a no-op.
 */
export function buildSidecarCmd(
  captureId: string,
  filter?: string,
  maxPackets?: number,
): string[] {
  let tcpdumpArgs = `-i any -w /tmp/capture_${captureId}.pcap -U`;

  if (maxPackets) {
    tcpdumpArgs += ` -c ${maxPackets}`;
  }

  if (filter) {
    tcpdumpArgs += ` ${filter}`;
  }

  // Install tcpdump if not present (covers plain alpine:3.21 default image).
  // Custom pcap-agent images already have tcpdump, so `command -v` succeeds immediately.
  const install = 'command -v tcpdump >/dev/null 2>&1 || apk add --no-cache tcpdump >/dev/null 2>&1 || true';
  return ['sh', '-c', `${install}; exec tcpdump ${tcpdumpArgs}`];
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

/**
 * Ensure the capture image is available on the endpoint, pulling if necessary
 * based on the configured pull policy.
 */
export async function ensureCaptureImage(
  endpointId: number,
  image: string,
  pullPolicy: string,
): Promise<void> {
  if (pullPolicy === 'never') return;

  if (pullPolicy === 'if-not-present') {
    const images = await getImages(endpointId);
    const exists = images.some((img) =>
      img.RepoTags?.some((tag: string) => tag === image),
    );
    if (exists) return;
  }

  // pullPolicy === 'always' or image not present
  const colonIdx = image.indexOf(':');
  const name = colonIdx >= 0 ? image.substring(0, colonIdx) : image;
  const tag = colonIdx >= 0 ? image.substring(colonIdx + 1) : 'latest';
  await pullImage(endpointId, name, tag);
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
    // Ensure the capture image is available on the endpoint
    await ensureCaptureImage(
      params.endpointId,
      config.PCAP_CAPTURE_IMAGE,
      config.PCAP_CAPTURE_IMAGE_PULL,
    );

    // Build sidecar command
    const cmd = buildSidecarCmd(captureId, params.filter, params.maxPackets);
    const sidecarName = `ai-dash-pcap-${captureId.slice(0, 8)}`;

    // Create sidecar container sharing target's network namespace
    const { Id: sidecarId } = await createContainer(
      params.endpointId,
      {
        Image: config.PCAP_CAPTURE_IMAGE,
        Entrypoint: ['sh', '-c'],
        Cmd: [cmd[2]], // the script string from buildSidecarCmd
        Labels: {
          'ai-dash.pcap': 'true',
          'ai-dash.pcap.capture-id': captureId,
          'ai-dash.pcap.target': params.containerId,
        },
        HostConfig: {
          NetworkMode: `container:${params.containerId}`,
          CapAdd: ['NET_RAW'],
          CapDrop: ['ALL'],
        },
      },
      sidecarName,
    );

    // Start the sidecar container
    await startContainer(params.endpointId, sidecarId);

    // Update status to capturing with sidecar_id
    await updateCaptureStatus(captureId, 'capturing', {
      sidecar_id: sidecarId,
      started_at: new Date().toISOString(),
    });

    // Start polling sidecar container state
    startPolling(captureId, params.endpointId, sidecarId, duration);

    log.info(
      { captureId, containerId: params.containerId, sidecarId, filter: params.filter, duration },
      'Packet capture started via sidecar container',
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
  sidecarId: string,
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
        await stopCaptureInternal(captureId, endpointId, sidecarId);
        return;
      }

      // Poll sidecar container state.
      // ContainerSchema parses State as a string ("running", "exited", "dead", etc.).
      const containerInfo = await getContainer(endpointId, sidecarId);
      const state = containerInfo.State;

      if (state !== 'running') {
        clearInterval(interval);
        activeCaptures.delete(captureId);

        if (state === 'exited' || state === 'dead') {
          // Attempt to download the capture regardless of exit code —
          // if tcpdump wrote any data before exiting, we want it.
          // downloadAndProcessCapture will mark as 'failed' if the pcap is empty.
          log.info({ captureId, state }, 'Capture sidecar stopped, downloading capture');
          await downloadAndProcessCapture(captureId, endpointId, sidecarId);
        } else {
          log.warn(
            { captureId, state },
            'Capture sidecar in unexpected state',
          );
          await updateCaptureStatus(captureId, 'failed', {
            error_message: `Capture sidecar in unexpected state: ${state}`,
            completed_at: new Date().toISOString(),
          });
        }

        // Clean up sidecar container
        try {
          await removeContainer(endpointId, sidecarId, true);
        } catch (cleanupErr) {
          log.warn({ captureId, sidecarId, err: cleanupErr }, 'Failed to remove sidecar container');
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
  sidecarId: string,
): Promise<void> {
  await updateCaptureStatus(captureId, 'processing');

  try {
    const config = getConfig();
    const containerPath = `/tmp/capture_${captureId}.pcap`;

    // Extract PCAP file from the sidecar container (not the target)
    const tarBuffer = await getArchive(endpointId, sidecarId, containerPath);

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

    // CWE-22 fix: validate filename stays inside storage directory
    const storageDir = getStorageDir();
    const filename = `capture_${captureId}.pcap`;
    const filePath = safePath(storageDir, filename);
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
  sidecarId: string,
): Promise<void> {
  try {
    // Stop the sidecar container (sends SIGTERM -> tcpdump flushes pcap)
    await stopContainer(endpointId, sidecarId);

    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Download the capture from the stopped sidecar
    await downloadAndProcessCapture(captureId, endpointId, sidecarId);

    // If it completed, override status to 'succeeded' to indicate manual stop
    const capture = await getCapture(captureId);
    if (capture && capture.status === 'complete') {
      await updateCaptureStatus(captureId, 'succeeded');
    }

    // Remove the sidecar container
    try {
      await removeContainer(endpointId, sidecarId, true);
    } catch (cleanupErr) {
      log.warn({ captureId, sidecarId, err: cleanupErr }, 'Failed to remove sidecar after stop');
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

  // Use sidecar_id if available, fall back to container_id for legacy captures
  const sidecarId = capture.sidecar_id || capture.container_id;
  await stopCaptureInternal(id, capture.endpoint_id, sidecarId);

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

  // CWE-22 fix: validate capture_file from DB stays inside storage directory
  if (capture.capture_file) {
    try {
      const storageDir = getStorageDir();
      const filePath = safePath(storageDir, capture.capture_file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      if (err instanceof PathTraversalError) {
        log.warn({ captureId: id, captureFile: capture.capture_file }, 'Path traversal in capture_file from DB, skipping file deletion');
      } else {
        log.warn({ captureId: id, err }, 'Failed to delete capture file');
      }
    }
  }

  await deleteDbCapture(id);
}

export async function getCaptureFilePath(id: string): Promise<string | null> {
  const capture = await getCapture(id);
  if (!capture || !capture.capture_file) return null;

  const storageDir = getStorageDir();

  // CWE-22 fix: replaces ad-hoc startsWith check (which lacked path.sep suffix)
  let filePath: string;
  try {
    filePath = safePath(storageDir, capture.capture_file);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      log.warn({ captureId: id }, 'Path traversal attempt detected in capture_file');
      return null;
    }
    throw err;
  }

  if (!fs.existsSync(filePath)) return null;

  return filePath;
}

export async function cleanupOldCaptures(): Promise<void> {
  const config = getConfig();
  const storageDir = getStorageDir();

  // Get captures that will be cleaned -- query the files before deleting DB records
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

  // CWE-22 fix: validate capture_file from DB stays inside storage directory
  for (const capture of oldCaptures) {
    if (capture.capture_file) {
      try {
        const filePath = safePath(storageDir, capture.capture_file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        if (err instanceof PathTraversalError) {
          log.warn({ file: capture.capture_file }, 'Path traversal in capture_file from DB, skipping cleanup');
        } else {
          log.warn({ file: capture.capture_file, err }, 'Failed to delete old capture file');
        }
      }
    }
  }

  // Clean DB records
  await cleanDbOldCaptures(config.PCAP_RETENTION_DAYS);
}

/**
 * Find and remove orphaned sidecar containers (exited, dead, or created but never started).
 * Runs as part of the periodic cleanup cycle to prevent container leaks.
 */
export async function cleanupOrphanedSidecars(endpointIds: number[]): Promise<number> {
  let cleaned = 0;
  for (const endpointId of endpointIds) {
    try {
      const containers = await getContainers(endpointId, true);
      const orphans = containers.filter((c) =>
        c.Labels?.['ai-dash.pcap'] === 'true' &&
        (c.State === 'exited' || c.State === 'dead' || c.State === 'created'),
      );
      for (const orphan of orphans) {
        try {
          await removeContainer(endpointId, orphan.Id, true);
          cleaned++;
        } catch (err) {
          log.warn({ containerId: orphan.Id, err }, 'Failed to clean orphaned sidecar');
        }
      }
    } catch (err) {
      log.warn({ endpointId, err }, 'Failed to list containers for sidecar cleanup');
    }
  }
  if (cleaned > 0) {
    log.info({ cleaned }, 'Orphaned capture sidecars cleaned up');
  }
  return cleaned;
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
