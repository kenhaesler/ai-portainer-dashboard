import path from 'path';

/**
 * Path traversal guard (CWE-22).
 *
 * Resolves `untrustedSegment` relative to `baseDir` and verifies the result
 * stays strictly inside `baseDir`. Returns the resolved absolute path on
 * success, or throws a descriptive error on violation.
 *
 * The check is intentionally strict:
 *  - The resolved path must start with `<baseDir>/` (note the trailing separator).
 *    This prevents a base of `/data/backups` from matching `/data/backups-evil`.
 *  - Null bytes are rejected outright (common bypass on some OSes).
 *
 * @param baseDir           Trusted root directory (will be resolved to absolute)
 * @param untrustedSegment  User-supplied or externally-sourced path fragment
 * @returns                 Resolved absolute path guaranteed to be inside `baseDir`
 * @throws {PathTraversalError} when the resolved path escapes `baseDir`
 */
export function safePath(baseDir: string, untrustedSegment: string): string {
  // Reject null bytes — a classic bypass on Windows and some Unix systems
  if (untrustedSegment.includes('\0') || baseDir.includes('\0')) {
    throw new PathTraversalError(baseDir, untrustedSegment, 'null byte in path');
  }

  // NOTE: Semgrep flags path.resolve here as a potential path traversal sink.
  // This is a FALSE POSITIVE — this function IS the path-traversal sanitizer.
  // We intentionally resolve the untrusted input so we can validate containment
  // via the startsWith guard below. All callers use safePath() instead of raw
  // path.join/path.resolve, which is the mitigation for CWE-22.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolvedBase = path.resolve(baseDir); // nosemgrep: path-join-resolve-traversal
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolvedFull = path.resolve(resolvedBase, untrustedSegment); // nosemgrep: path-join-resolve-traversal

  // The resolved path must be strictly inside the base directory.
  // Using `path.sep` suffix prevents prefix-overlap attacks
  // (e.g. base=/data/backups matching /data/backups-evil).
  if (!resolvedFull.startsWith(`${resolvedBase}${path.sep}`) && resolvedFull !== resolvedBase) {
    throw new PathTraversalError(resolvedBase, untrustedSegment);
  }

  return resolvedFull;
}

/**
 * Structured error for path traversal violations.
 * Does NOT include the resolved path in the message to avoid leaking
 * filesystem layout to potential attackers.
 */
export class PathTraversalError extends Error {
  public readonly code = 'ERR_PATH_TRAVERSAL';

  constructor(
    public readonly baseDir: string,
    public readonly segment: string,
    detail?: string,
  ) {
    const reason = detail ?? 'path escapes base directory';
    super(`Path traversal detected: ${reason}`);
    this.name = 'PathTraversalError';
  }
}
