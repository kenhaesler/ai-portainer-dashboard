import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    PCAP_ENABLED: true,
    PCAP_MAX_DURATION_SECONDS: 300,
    PCAP_MAX_FILE_SIZE_MB: 50,
    PCAP_MAX_CONCURRENT: 2,
    PCAP_RETENTION_DAYS: 7,
    PCAP_STORAGE_DIR: '/tmp/test-pcap',
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockCreateExec = vi.fn();
const mockStartExec = vi.fn();
const mockInspectExec = vi.fn();
const mockGetArchive = vi.fn();
vi.mock('./portainer-client.js', () => ({
  createExec: (...args: unknown[]) => mockCreateExec(...args),
  startExec: (...args: unknown[]) => mockStartExec(...args),
  inspectExec: (...args: unknown[]) => mockInspectExec(...args),
  getArchive: (...args: unknown[]) => mockGetArchive(...args),
}));

const mockInsertCapture = vi.fn();
const mockUpdateCaptureStatus = vi.fn();
const mockGetCapture = vi.fn();
const mockGetCaptures = vi.fn().mockReturnValue([]);
const mockGetCapturesCount = vi.fn().mockReturnValue(0);
const mockDeleteCapture = vi.fn();
const mockCleanOldCaptures = vi.fn();
vi.mock('./pcap-store.js', () => ({
  insertCapture: (...args: unknown[]) => mockInsertCapture(...args),
  updateCaptureStatus: (...args: unknown[]) => mockUpdateCaptureStatus(...args),
  getCapture: (...args: unknown[]) => mockGetCapture(...args),
  getCaptures: (...args: unknown[]) => mockGetCaptures(...args),
  getCapturesCount: (...args: unknown[]) => mockGetCapturesCount(...args),
  deleteCapture: (...args: unknown[]) => mockDeleteCapture(...args),
  cleanOldCaptures: (...args: unknown[]) => mockCleanOldCaptures(...args),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

const { buildTcpdumpCommand, extractFromTar, startCapture, stopCapture, getCaptureById, deleteCaptureById } =
  await import('./pcap-service.js');

describe('pcap-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCapturesCount.mockReturnValue(0);
  });

  describe('buildTcpdumpCommand', () => {
    it('should build basic tcpdump command', () => {
      const cmd = buildTcpdumpCommand('test-id-123');
      expect(cmd).toContain('tcpdump');
      expect(cmd).toContain('-i');
      expect(cmd).toContain('any');
      expect(cmd).toContain('-w');
      expect(cmd).toContain('/tmp/capture_test-id-123.pcap');
      expect(cmd).toContain('-U');
    });

    it('should include filter in command', () => {
      const cmd = buildTcpdumpCommand('test-id', 'port 80');
      expect(cmd).toContain('port');
      expect(cmd).toContain('80');
    });

    it('should include max packets flag', () => {
      const cmd = buildTcpdumpCommand('test-id', undefined, undefined, 1000);
      expect(cmd).toContain('-c');
      expect(cmd).toContain('1000');
    });

    it('should combine all options', () => {
      const cmd = buildTcpdumpCommand('test-id', 'tcp', 60, 500);
      expect(cmd).toContain('-c');
      expect(cmd).toContain('500');
      expect(cmd).toContain('tcp');
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

  describe('startCapture', () => {
    it('should throw when PCAP is disabled', async () => {
      const { getConfig } = await import('../config/index.js');
      vi.mocked(getConfig).mockReturnValue({
        PCAP_ENABLED: false,
      } as ReturnType<typeof getConfig>);

      await expect(startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
      })).rejects.toThrow('Packet capture is not enabled');

      // Restore
      vi.mocked(getConfig).mockReturnValue({
        PCAP_ENABLED: true,
        PCAP_MAX_DURATION_SECONDS: 300,
        PCAP_MAX_FILE_SIZE_MB: 50,
        PCAP_MAX_CONCURRENT: 2,
        PCAP_RETENTION_DAYS: 7,
        PCAP_STORAGE_DIR: '/tmp/test-pcap',
      } as ReturnType<typeof getConfig>);
    });

    it('should throw when concurrency limit is reached', async () => {
      mockGetCapturesCount.mockReturnValue(2);

      await expect(startCapture({
        endpointId: 1,
        containerId: 'abc123',
        containerName: 'test',
      })).rejects.toThrow('Concurrency limit reached');
    });

    it('should create exec and start polling on success', async () => {
      mockGetCapturesCount.mockReturnValue(0);
      mockCreateExec.mockResolvedValue({ Id: 'exec-123' });
      mockStartExec.mockResolvedValue(undefined);
      mockGetCapture.mockReturnValue({
        id: 'capture-id',
        status: 'capturing',
        endpoint_id: 1,
        container_id: 'abc123',
        container_name: 'test',
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
      expect(mockCreateExec).toHaveBeenCalledWith(1, 'abc123', expect.arrayContaining(['tcpdump']));
      expect(mockStartExec).toHaveBeenCalledWith(1, 'exec-123');
      expect(mockUpdateCaptureStatus).toHaveBeenCalledWith(
        expect.any(String),
        'capturing',
        expect.objectContaining({ exec_id: 'exec-123' }),
      );
      expect(result.status).toBe('capturing');
    });

    it('should enforce max duration from config', async () => {
      mockGetCapturesCount.mockReturnValue(0);
      mockCreateExec.mockResolvedValue({ Id: 'exec-123' });
      mockStartExec.mockResolvedValue(undefined);
      mockGetCapture.mockReturnValue({ id: 'x', status: 'capturing' });

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

    it('should mark as failed when exec creation fails', async () => {
      mockGetCapturesCount.mockReturnValue(0);
      mockCreateExec.mockRejectedValue(new Error('Container not found'));

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
  });

  describe('stopCapture', () => {
    it('should throw when capture not found', async () => {
      mockGetCapture.mockReturnValue(undefined);
      await expect(stopCapture('not-found')).rejects.toThrow('Capture not found');
    });

    it('should throw when capture is not in stoppable state', async () => {
      mockGetCapture.mockReturnValue({ id: 'x', status: 'complete' });
      await expect(stopCapture('x')).rejects.toThrow('Cannot stop capture in status: complete');
    });

    it('should send pkill and update status', async () => {
      // First call: stopCapture checks status
      // Second call: stopCaptureInternal → downloadAndProcessCapture → getCapture for status check after processing
      // Third call: final getCapture at end of stopCapture
      mockGetCapture
        .mockReturnValueOnce({ id: 'x', status: 'capturing', endpoint_id: 1, container_id: 'abc' })
        .mockReturnValueOnce({ id: 'x', status: 'complete', endpoint_id: 1, container_id: 'abc' })
        .mockReturnValueOnce({ id: 'x', status: 'stopped', endpoint_id: 1, container_id: 'abc' });
      mockCreateExec.mockResolvedValue({ Id: 'kill-exec' });
      mockStartExec.mockResolvedValue(undefined);
      mockGetArchive.mockRejectedValue(new Error('no file'));

      const result = await stopCapture('x');

      expect(mockCreateExec).toHaveBeenCalledWith(1, 'abc', ['pkill', '-f', 'capture_x']);
      expect(result.status).toBe('stopped');
    });
  });

  describe('getCaptureById', () => {
    it('should return capture from store', () => {
      const capture = { id: 'test', status: 'complete' };
      mockGetCapture.mockReturnValue(capture);
      expect(getCaptureById('test')).toEqual(capture);
    });

    it('should return undefined for non-existent capture', () => {
      mockGetCapture.mockReturnValue(undefined);
      expect(getCaptureById('not-found')).toBeUndefined();
    });
  });

  describe('deleteCaptureById', () => {
    it('should throw when capture not found', () => {
      mockGetCapture.mockReturnValue(undefined);
      expect(() => deleteCaptureById('not-found')).toThrow('Capture not found');
    });

    it('should throw when capture is active', () => {
      mockGetCapture.mockReturnValue({ id: 'x', status: 'capturing' });
      expect(() => deleteCaptureById('x')).toThrow('Cannot delete an active capture');
    });

    it('should delete capture and file', () => {
      mockGetCapture.mockReturnValue({
        id: 'x',
        status: 'complete',
        capture_file: 'capture_x.pcap',
      });

      deleteCaptureById('x');

      expect(mockDeleteCapture).toHaveBeenCalledWith('x');
    });
  });
});
