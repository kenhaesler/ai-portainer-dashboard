import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '../core/config/index.js';

const mockInsertCapture = vi.fn().mockResolvedValue(undefined);
const mockUpdateCaptureStatus = vi.fn().mockResolvedValue(undefined);
const mockGetCapture = vi.fn().mockResolvedValue(undefined);
const mockGetCaptures = vi.fn().mockResolvedValue([]);
const mockGetCapturesCount = vi.fn().mockResolvedValue(0);
const mockDeleteCapture = vi.fn().mockResolvedValue(true);
const mockCleanOldCaptures = vi.fn().mockResolvedValue(0);
// Kept: DB-backed store mock — pcap-store writes to PostgreSQL
vi.mock('./pcap-store.js', () => ({
  insertCapture: (...args: unknown[]) => mockInsertCapture(...args),
  updateCaptureStatus: (...args: unknown[]) => mockUpdateCaptureStatus(...args),
  getCapture: (...args: unknown[]) => mockGetCapture(...args),
  getCaptures: (...args: unknown[]) => mockGetCaptures(...args),
  getCapturesCount: (...args: unknown[]) => mockGetCapturesCount(...args),
  deleteCapture: (...args: unknown[]) => mockDeleteCapture(...args),
  cleanOldCaptures: (...args: unknown[]) => mockCleanOldCaptures(...args),
}));

// Kept: filesystem mock — prevents real disk writes during tests
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

const {
  buildSidecarCmd,
  extractFromTar,
  ensureCaptureImage,
  startCapture,
  stopCapture,
  getCaptureById,
  deleteCaptureById,
  cleanupOrphanedSidecars,
} = await import('./pcap-service.js');
import * as portainer from '../core/portainer/portainer-client.js';


beforeAll(() => {
    setConfigForTest({
      PCAP_ENABLED: true,
      PCAP_MAX_DURATION_SECONDS: 300,
      PCAP_MAX_FILE_SIZE_MB: 50,
      PCAP_MAX_CONCURRENT: 2,
      PCAP_RETENTION_DAYS: 7,
      PCAP_STORAGE_DIR: '/tmp/test-pcap',
      PCAP_CAPTURE_IMAGE: 'alpine:3.21',
      PCAP_CAPTURE_IMAGE_PULL: 'if-not-present',
    });
});

afterAll(() => {
  resetConfig();
});

describe('pcap-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetCapturesCount.mockResolvedValue(0);
  });

  describe('buildSidecarCmd', () => {
    it('should build sh -c wrapper with tcpdump', () => {
      const cmd = buildSidecarCmd('test-id-123');
      expect(cmd[0]).toBe('sh');
      expect(cmd[1]).toBe('-c');
      const script = cmd[2];
      expect(script).toContain('command -v tcpdump');
      expect(script).toContain('apk add');
      expect(script).toContain('exec tcpdump -i any -w /tmp/capture_test-id-123.pcap -U');
    });

    it('should include filter in command', () => {
      const cmd = buildSidecarCmd('test-id', 'port 80');
      expect(cmd[2]).toContain('port 80');
    });

    it('should include max packets flag', () => {
      const cmd = buildSidecarCmd('test-id', undefined, 1000);
      expect(cmd[2]).toContain('-c 1000');
    });

    it('should combine filter and maxPackets', () => {
      const cmd = buildSidecarCmd('test-id', 'tcp', 500);
      expect(cmd[2]).toContain('-c 500');
      expect(cmd[2]).toContain('tcp');
    });
  });

  describe('extractFromTar', () => {
    it('should extract file data from a tar buffer', () => {
      // Create a minimal tar buffer with a 512-byte header + file data
      const fileContent = Buffer.from('PCAP-DATA-HERE');
      const header = Buffer.alloc(512, 0);

      // Write file size at offset 124 in octal (14 bytes = "16" in octal)
      const sizeOctal = fileContent.length.toString(8).padStart(11, '0');
      header.write(sizeOctal, 124, 'ascii');

      const tar = Buffer.concat([header, fileContent, Buffer.alloc(512 - fileContent.length, 0)]);
      const result = extractFromTar(tar);

      expect(result).not.toBeNull();
      expect(result!.toString()).toBe('PCAP-DATA-HERE');
    });

    it('should return null for empty buffer', () => {
      const result = extractFromTar(Buffer.alloc(0));
      expect(result).toBeNull();
    });

    it('should return null for buffer smaller than header', () => {
      const result = extractFromTar(Buffer.alloc(100));
      expect(result).toBeNull();
    });

    it('should return null when file size is zero', () => {
      const header = Buffer.alloc(512, 0);
      header.write('00000000000', 124, 'ascii');
      const result = extractFromTar(header);
      expect(result).toBeNull();
    });

    it('should return null when buffer is too short for declared file size', () => {
      const header = Buffer.alloc(512, 0);
      // Declare 1000 bytes but only provide header
      header.write('00000001750', 124, 'ascii'); // 1000 in octal
      const result = extractFromTar(header);
      expect(result).toBeNull();
    });
  });

  describe('ensureCaptureImage', () => {
    it('should skip pull when policy is "never"', async () => {
      const pullSpy = vi.spyOn(portainer, 'pullImage').mockResolvedValue(undefined);
      const imagesSpy = vi.spyOn(portainer, 'getImages').mockResolvedValue([]);

      await ensureCaptureImage(1, 'alpine:3.21', 'never');

      expect(pullSpy).not.toHaveBeenCalled();
      expect(imagesSpy).not.toHaveBeenCalled();
    });

    it('should skip pull when policy is "if-not-present" and image exists', async () => {
      const pullSpy = vi.spyOn(portainer, 'pullImage').mockResolvedValue(undefined);
      vi.spyOn(portainer, 'getImages').mockResolvedValue([
        { Id: 'sha256:abc', RepoTags: ['alpine:3.21'], Created: 0, Size: 0 },
      ] as any);

      await ensureCaptureImage(1, 'alpine:3.21', 'if-not-present');

      expect(pullSpy).not.toHaveBeenCalled();
    });

    it('should pull when policy is "if-not-present" and image is missing', async () => {
      const pullSpy = vi.spyOn(portainer, 'pullImage').mockResolvedValue(undefined);
      vi.spyOn(portainer, 'getImages').mockResolvedValue([]);

      await ensureCaptureImage(1, 'alpine:3.21', 'if-not-present');

      expect(pullSpy).toHaveBeenCalledWith(1, 'alpine', '3.21');
    });

    it('should always pull when policy is "always"', async () => {
      const pullSpy = vi.spyOn(portainer, 'pullImage').mockResolvedValue(undefined);

      await ensureCaptureImage(1, 'alpine:3.21', 'always');

      expect(pullSpy).toHaveBeenCalledWith(1, 'alpine', '3.21');
    });

    it('should default to "latest" tag when no tag specified', async () => {
      const pullSpy = vi.spyOn(portainer, 'pullImage').mockResolvedValue(undefined);

      await ensureCaptureImage(1, 'myimage', 'always');

      expect(pullSpy).toHaveBeenCalledWith(1, 'myimage', 'latest');
    });
  });

  describe('startCapture', () => {
    it('should throw when PCAP is disabled', async () => {
      setConfigForTest({ PCAP_ENABLED: false });

      await expect(startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
      })).rejects.toThrow('Packet capture is not enabled');

      // Restore defaults for remaining tests
      setConfigForTest({
        PCAP_ENABLED: true,
        PCAP_MAX_DURATION_SECONDS: 300,
        PCAP_MAX_FILE_SIZE_MB: 50,
        PCAP_MAX_CONCURRENT: 2,
        PCAP_RETENTION_DAYS: 7,
        PCAP_STORAGE_DIR: '/tmp/test-pcap',
        PCAP_CAPTURE_IMAGE: 'alpine:3.21',
        PCAP_CAPTURE_IMAGE_PULL: 'if-not-present',
      });
    });

    it('should throw when concurrency limit is reached', async () => {
      mockGetCapturesCount.mockResolvedValue(2);

      await expect(startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
      })).rejects.toThrow('Concurrency limit reached');
    });

    it('should create sidecar container and start polling on success', async () => {
      mockGetCapturesCount.mockResolvedValue(0);
      vi.spyOn(portainer, 'getImages').mockResolvedValue([
        { Id: 'sha256:abc', RepoTags: ['alpine:3.21'], Created: 0, Size: 0 },
      ] as any);
      vi.spyOn(portainer, 'createContainer').mockResolvedValue({ Id: 'sidecar-123' });
      vi.spyOn(portainer, 'startContainer').mockResolvedValue(undefined);
      mockGetCapture.mockResolvedValue({
        id: 'capture-id',
        status: 'capturing',
        endpoint_id: 1,
        container_id: 'abc123',
        container_name: 'test',
        sidecar_id: 'sidecar-123',
      });

      const result = await startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
        filter: 'port 80',
        durationSeconds: 60,
      });

      expect(mockInsertCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint_id: 1,
          container_id: 'abc123',
          container_name: 'test',
          filter: 'port 80',
          duration_seconds: 60,
        }),
      );
      expect(portainer.createContainer).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          Image: 'alpine:3.21',
          Labels: expect.objectContaining({
            'ai-dash.pcap': 'true',
            'ai-dash.pcap.target': 'abc123',
          }),
          HostConfig: expect.objectContaining({
            NetworkMode: 'container:abc123',
            CapAdd: ['NET_RAW'],
            CapDrop: ['ALL'],
          }),
        }),
        expect.stringContaining('ai-dash-pcap-'),
      );
      expect(portainer.startContainer).toHaveBeenCalledWith(1, 'sidecar-123');
      expect(mockUpdateCaptureStatus).toHaveBeenCalledWith(
        expect.any(String),
        'capturing',
        expect.objectContaining({ sidecar_id: 'sidecar-123' }),
      );
      expect(result.status).toBe('capturing');
    });

    it('should enforce max duration from config', async () => {
      mockGetCapturesCount.mockResolvedValue(0);
      vi.spyOn(portainer, 'getImages').mockResolvedValue([
        { Id: 'sha256:abc', RepoTags: ['alpine:3.21'], Created: 0, Size: 0 },
      ] as any);
      vi.spyOn(portainer, 'createContainer').mockResolvedValue({ Id: 'sidecar-123' });
      vi.spyOn(portainer, 'startContainer').mockResolvedValue(undefined);
      mockGetCapture.mockResolvedValue({ id: 'x', status: 'capturing' });

      await startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
        durationSeconds: 9999, // exceeds max
      });

      expect(mockInsertCapture).toHaveBeenCalledWith(
        expect.objectContaining({ duration_seconds: 300 }),
      );
    });

    it('should mark as failed when container creation fails', async () => {
      mockGetCapturesCount.mockResolvedValue(0);
      vi.spyOn(portainer, 'getImages').mockResolvedValue([
        { Id: 'sha256:abc', RepoTags: ['alpine:3.21'], Created: 0, Size: 0 },
      ] as any);
      vi.spyOn(portainer, 'createContainer').mockRejectedValue(new Error('Container not found'));

      await expect(startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
      })).rejects.toThrow('Container not found');

      expect(mockUpdateCaptureStatus).toHaveBeenCalledWith(
        expect.any(String),
        'failed',
        expect.objectContaining({ error_message: 'Container not found' }),
      );
    });

    it('should create sidecar with correct NetworkMode and capabilities', async () => {
      mockGetCapturesCount.mockResolvedValue(0);
      vi.spyOn(portainer, 'getImages').mockResolvedValue([
        { Id: 'sha256:abc', RepoTags: ['alpine:3.21'], Created: 0, Size: 0 },
      ] as any);
      const createSpy = vi.spyOn(portainer, 'createContainer').mockResolvedValue({ Id: 'sc-1' });
      vi.spyOn(portainer, 'startContainer').mockResolvedValue(undefined);
      mockGetCapture.mockResolvedValue({ id: 'x', status: 'capturing', sidecar_id: 'sc-1' });

      await startCapture({
        endpointId: 2,
        containerId: 'target-container-id',
        containerName: 'my-app',
      });

      const payload = createSpy.mock.calls[0][1];
      expect(payload.HostConfig?.NetworkMode).toBe('container:target-container-id');
      expect(payload.HostConfig?.CapAdd).toEqual(['NET_RAW']);
      expect(payload.HostConfig?.CapDrop).toEqual(['ALL']);
      expect(payload.Labels?.['ai-dash.pcap']).toBe('true');
      expect(payload.Labels?.['ai-dash.pcap.target']).toBe('target-container-id');
    });
  });

  describe('stopCapture', () => {
    it('should throw when capture not found', async () => {
      mockGetCapture.mockResolvedValue(undefined);
      await expect(stopCapture('not-found')).rejects.toThrow('Capture not found');
    });

    it('should throw when capture is not in stoppable state', async () => {
      mockGetCapture.mockResolvedValue({ id: 'x', status: 'complete' });
      await expect(stopCapture('x')).rejects.toThrow('Cannot stop capture in status: complete');
    });

    it('should stop sidecar container and update status', async () => {
      mockGetCapture
        .mockResolvedValueOnce({ id: 'x', status: 'capturing', endpoint_id: 1, container_id: 'abc', sidecar_id: 'sc-1' })
        .mockResolvedValueOnce({ id: 'x', status: 'complete', endpoint_id: 1, container_id: 'abc', sidecar_id: 'sc-1' })
        .mockResolvedValueOnce({ id: 'x', status: 'succeeded', endpoint_id: 1, container_id: 'abc', sidecar_id: 'sc-1' });
      vi.spyOn(portainer, 'stopContainer').mockResolvedValue(undefined);
      vi.spyOn(portainer, 'removeContainer').mockResolvedValue(undefined);
      vi.spyOn(portainer, 'getArchive').mockRejectedValue(new Error('no file'));

      const result = await stopCapture('x');

      expect(portainer.stopContainer).toHaveBeenCalledWith(1, 'sc-1');
      expect(result.status).toBe('succeeded');
    });
  });

  describe('getCaptureById', () => {
    it('should return capture from store', async () => {
      const capture = { id: 'test', status: 'complete' };
      mockGetCapture.mockResolvedValue(capture);
      await expect(getCaptureById('test')).resolves.toEqual(capture);
    });

    it('should return undefined for non-existent capture', async () => {
      mockGetCapture.mockResolvedValue(undefined);
      await expect(getCaptureById('not-found')).resolves.toBeUndefined();
    });
  });

  describe('deleteCaptureById', () => {
    it('should throw when capture not found', async () => {
      mockGetCapture.mockResolvedValue(undefined);
      await expect(deleteCaptureById('not-found')).rejects.toThrow('Capture not found');
    });

    it('should throw when capture is active', async () => {
      mockGetCapture.mockResolvedValue({ id: 'x', status: 'capturing' });
      await expect(deleteCaptureById('x')).rejects.toThrow('Cannot delete an active capture');
    });

    it('should delete capture and file', async () => {
      mockGetCapture.mockResolvedValue({
        id: 'x',
        status: 'complete',
        capture_file: 'capture_x.pcap',
      });

      await deleteCaptureById('x');

      expect(mockDeleteCapture).toHaveBeenCalledWith('x');
    });
  });

  describe('cleanupOrphanedSidecars', () => {
    it('should find and remove exited sidecar containers', async () => {
      vi.spyOn(portainer, 'getContainers').mockResolvedValue([
        {
          Id: 'orphan-1',
          Names: ['/ai-dash-pcap-abc'],
          State: 'exited',
          Status: 'Exited (0)',
          Labels: { 'ai-dash.pcap': 'true', 'ai-dash.pcap.capture-id': 'cap-1' },
        },
        {
          Id: 'running-1',
          Names: ['/ai-dash-pcap-def'],
          State: 'running',
          Status: 'Up 5 minutes',
          Labels: { 'ai-dash.pcap': 'true' },
        },
        {
          Id: 'normal-1',
          Names: ['/my-app'],
          State: 'running',
          Status: 'Up 1 hour',
          Labels: {},
        },
      ] as any);
      const removeSpy = vi.spyOn(portainer, 'removeContainer').mockResolvedValue(undefined);

      const cleaned = await cleanupOrphanedSidecars([1]);

      expect(cleaned).toBe(1);
      expect(removeSpy).toHaveBeenCalledWith(1, 'orphan-1', true);
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple endpoints', async () => {
      vi.spyOn(portainer, 'getContainers').mockImplementation(async (endpointId: number) => {
        if (endpointId === 1) {
          return [{
            Id: 'orphan-1',
            Names: ['/ai-dash-pcap-a'],
            State: 'exited',
            Status: 'Exited (0)',
            Labels: { 'ai-dash.pcap': 'true' },
          }] as any;
        }
        return [{
          Id: 'orphan-2',
          Names: ['/ai-dash-pcap-b'],
          State: 'dead',
          Status: 'Dead',
          Labels: { 'ai-dash.pcap': 'true' },
        }] as any;
      });
      vi.spyOn(portainer, 'removeContainer').mockResolvedValue(undefined);

      const cleaned = await cleanupOrphanedSidecars([1, 2]);

      expect(cleaned).toBe(2);
    });

    it('should handle remove failures gracefully', async () => {
      vi.spyOn(portainer, 'getContainers').mockResolvedValue([
        {
          Id: 'orphan-1',
          Names: ['/ai-dash-pcap-a'],
          State: 'exited',
          Status: 'Exited (0)',
          Labels: { 'ai-dash.pcap': 'true' },
        },
      ] as any);
      vi.spyOn(portainer, 'removeContainer').mockRejectedValue(new Error('busy'));

      const cleaned = await cleanupOrphanedSidecars([1]);

      // Failed to remove, so cleaned count stays 0
      expect(cleaned).toBe(0);
    });

    it('should return 0 when no orphans exist', async () => {
      vi.spyOn(portainer, 'getContainers').mockResolvedValue([
        {
          Id: 'running-1',
          Names: ['/ai-dash-pcap-a'],
          State: 'running',
          Status: 'Up',
          Labels: { 'ai-dash.pcap': 'true' },
        },
      ] as any);

      const cleaned = await cleanupOrphanedSidecars([1]);

      expect(cleaned).toBe(0);
    });
  });
});
