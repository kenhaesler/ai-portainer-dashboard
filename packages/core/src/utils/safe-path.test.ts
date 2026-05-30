import path from 'path';
import { describe, it, expect } from 'vitest';
import { safePath, PathTraversalError } from './safe-path.js';

describe('safePath', () => {
  const baseDir = '/data/backups';

  describe('valid paths', () => {
    it('resolves a simple filename inside the base directory', () => {
      const result = safePath(baseDir, 'backup-2024.dump');
      expect(result).toBe(path.resolve(baseDir, 'backup-2024.dump'));
    });

    it('resolves a filename with dots and dashes', () => {
      const result = safePath(baseDir, 'my-backup.2024-01-15.dump');
      expect(result).toBe(path.resolve(baseDir, 'my-backup.2024-01-15.dump'));
    });

    it('resolves a nested path within the base directory', () => {
      const result = safePath(baseDir, 'subdir/file.dump');
      expect(result).toBe(path.resolve(baseDir, 'subdir/file.dump'));
    });

    it('normalizes redundant slashes', () => {
      const result = safePath(baseDir, 'subdir//file.dump');
      expect(result).toBe(path.resolve(baseDir, 'subdir/file.dump'));
    });

    it('normalizes safe relative segments that stay inside base', () => {
      const result = safePath(baseDir, 'subdir/../file.dump');
      expect(result).toBe(path.resolve(baseDir, 'file.dump'));
    });
  });

  describe('path traversal attacks', () => {
    it('rejects ../ to escape the base directory', () => {
      expect(() => safePath(baseDir, '../etc/passwd')).toThrow(PathTraversalError);
    });

    it('rejects ../../ double traversal', () => {
      expect(() => safePath(baseDir, '../../etc/shadow')).toThrow(PathTraversalError);
    });

    it('rejects absolute path that escapes base', () => {
      expect(() => safePath(baseDir, '/etc/passwd')).toThrow(PathTraversalError);
    });

    it('rejects traversal disguised in the middle of a path', () => {
      expect(() => safePath(baseDir, 'subdir/../../etc/passwd')).toThrow(PathTraversalError);
    });

    it('rejects deeply nested traversal', () => {
      expect(() => safePath(baseDir, 'a/b/c/../../../../etc/passwd')).toThrow(PathTraversalError);
    });

    it('rejects null bytes in the untrusted segment', () => {
      expect(() => safePath(baseDir, 'file.dump\0.jpg')).toThrow(PathTraversalError);
      expect(() => safePath(baseDir, 'file.dump\0.jpg')).toThrow('null byte in path');
    });

    it('rejects null bytes in the base directory', () => {
      expect(() => safePath('/data\0/evil', 'file.dump')).toThrow(PathTraversalError);
      expect(() => safePath('/data\0/evil', 'file.dump')).toThrow('null byte in path');
    });

    it('rejects empty segment that resolves to the base itself', () => {
      // An empty segment resolves to the base directory itself.
      // We allow this (resolvedFull === resolvedBase) — the caller can
      // decide whether an empty filename makes sense.
      const result = safePath(baseDir, '.');
      expect(result).toBe(path.resolve(baseDir));
    });
  });

  describe('prefix-overlap attacks', () => {
    it('rejects a sibling directory that shares a prefix', () => {
      // e.g. base=/data/backups, attack tries /data/backups-evil/payload
      expect(() => safePath(baseDir, '../backups-evil/payload')).toThrow(PathTraversalError);
    });

    it('rejects paths that would land in a prefix-overlapping directory', () => {
      // Without the path.sep check, /data/backups-evil would pass
      // because "/data/backups-evil".startsWith("/data/backups") is true
      expect(() => safePath('/data/backups', '../backups-evil')).toThrow(PathTraversalError);
    });
  });

  describe('PathTraversalError properties', () => {
    it('has the correct error code', () => {
      try {
        safePath(baseDir, '../escape');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PathTraversalError);
        const pte = err as PathTraversalError;
        expect(pte.code).toBe('ERR_PATH_TRAVERSAL');
        expect(pte.name).toBe('PathTraversalError');
        expect(pte.message).toContain('Path traversal detected');
      }
    });

    it('does not leak the resolved path in the message', () => {
      try {
        safePath(baseDir, '../../../etc/passwd');
        expect.unreachable('should have thrown');
      } catch (err) {
        const pte = err as PathTraversalError;
        // The message should NOT contain the resolved target path
        expect(pte.message).not.toContain('/etc/passwd');
      }
    });
  });

  describe('relative base directory', () => {
    it('works with a relative base directory by resolving it first', () => {
      const result = safePath('./data/backups', 'file.dump');
      expect(result).toBe(path.resolve('./data/backups', 'file.dump'));
      expect(path.isAbsolute(result)).toBe(true);
    });
  });
});
