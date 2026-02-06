import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('image-staleness');

export interface ImageStalenessRecord {
  id: number;
  image_name: string;
  image_tag: string;
  registry: string;
  local_digest: string | null;
  remote_digest: string | null;
  is_stale: number;
  days_since_update: number | null;
  last_checked_at: string;
  created_at: string;
}

export interface StalenessCheckResult {
  imageName: string;
  tag: string;
  registry: string;
  isStale: boolean;
  daysSinceUpdate: number | null;
  localDigest: string | null;
  remoteDigest: string | null;
}

/**
 * Check Docker Hub for the latest digest of an image tag.
 * Returns the digest string or null if the check fails.
 */
export async function checkDockerHubDigest(
  imageName: string,
  tag: string,
): Promise<string | null> {
  try {
    // Get auth token for Docker Hub
    const library = imageName.startsWith('library/') ? imageName : `library/${imageName}`;
    const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${library}:pull`;
    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(10000) });
    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as { token?: string };
    if (!tokenData.token) return null;

    // Fetch manifest to get digest
    const manifestUrl = `https://registry-1.docker.io/v2/${library}/manifests/${tag}`;
    const manifestRes = await fetch(manifestUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
        Accept: 'application/vnd.docker.distribution.manifest.v2+json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!manifestRes.ok) return null;

    const digest = manifestRes.headers.get('docker-content-digest');
    return digest;
  } catch (err) {
    log.debug({ imageName, tag, err }, 'Failed to check Docker Hub digest');
    return null;
  }
}

/**
 * Parse image reference into components: registry, name, tag
 */
export function parseImageRef(ref: string): { registry: string; name: string; tag: string } {
  let registry = 'docker.io';
  let name = ref;
  let tag = 'latest';

  // Split tag
  const colonIdx = name.lastIndexOf(':');
  if (colonIdx > 0 && !name.substring(colonIdx).includes('/')) {
    tag = name.substring(colonIdx + 1);
    name = name.substring(0, colonIdx);
  }

  // Split registry
  const parts = name.split('/');
  if (parts.length > 1 && parts[0].includes('.')) {
    registry = parts[0];
    name = parts.slice(1).join('/');
  } else if (parts.length === 1) {
    name = `library/${parts[0]}`;
  }

  return { registry, name, tag };
}

/**
 * Check staleness for a single image tag.
 * Only supports Docker Hub for now.
 */
export async function checkImageStaleness(
  imageName: string,
  tag: string,
  registry: string,
  localDigest: string | null,
): Promise<StalenessCheckResult> {
  // Only Docker Hub is supported for registry checks
  if (registry !== 'docker.io') {
    return { imageName, tag, registry, isStale: false, daysSinceUpdate: null, localDigest, remoteDigest: null };
  }

  const remoteDigest = await checkDockerHubDigest(imageName, tag);

  const isStale = !!(remoteDigest && localDigest && remoteDigest !== localDigest);

  return {
    imageName,
    tag,
    registry,
    isStale,
    daysSinceUpdate: null,
    localDigest,
    remoteDigest,
  };
}

/**
 * Upsert a staleness check result into the database.
 */
export function upsertStalenessRecord(result: StalenessCheckResult): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO image_staleness (image_name, image_tag, registry, local_digest, remote_digest, is_stale, days_since_update, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(image_name, image_tag, registry)
    DO UPDATE SET
      local_digest = excluded.local_digest,
      remote_digest = excluded.remote_digest,
      is_stale = excluded.is_stale,
      days_since_update = excluded.days_since_update,
      last_checked_at = datetime('now')
  `).run(
    result.imageName,
    result.tag,
    result.registry,
    result.localDigest,
    result.remoteDigest,
    result.isStale ? 1 : 0,
    result.daysSinceUpdate,
  );
}

/**
 * Get all staleness records from the database.
 */
export function getStalenessRecords(): ImageStalenessRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM image_staleness ORDER BY is_stale DESC, last_checked_at DESC').all() as ImageStalenessRecord[];
}

/**
 * Get staleness summary stats.
 */
export function getStalenessSummary(): { total: number; stale: number; upToDate: number; unchecked: number } {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_stale = 1 THEN 1 ELSE 0 END) as stale,
      SUM(CASE WHEN is_stale = 0 AND remote_digest IS NOT NULL THEN 1 ELSE 0 END) as up_to_date,
      SUM(CASE WHEN remote_digest IS NULL THEN 1 ELSE 0 END) as unchecked
    FROM image_staleness
  `).get() as { total: number; stale: number; up_to_date: number; unchecked: number };

  return {
    total: row.total,
    stale: row.stale,
    upToDate: row.up_to_date,
    unchecked: row.unchecked,
  };
}

/**
 * Run staleness checks for a batch of images.
 */
export async function runStalenessChecks(
  images: Array<{ name: string; tags: string[]; registry: string; id: string }>,
): Promise<{ checked: number; stale: number }> {
  let checked = 0;
  let staleCount = 0;

  // De-duplicate by name:tag:registry
  const seen = new Set<string>();
  const uniqueImages: Array<{ name: string; tag: string; registry: string; digest: string | null }> = [];

  for (const img of images) {
    for (const fullTag of img.tags) {
      const parsed = parseImageRef(fullTag);
      const key = `${parsed.name}:${parsed.tag}:${parsed.registry}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Extract digest from image ID
        const digest = img.id.startsWith('sha256:') ? img.id : null;
        uniqueImages.push({ name: parsed.name, tag: parsed.tag, registry: parsed.registry, digest });
      }
    }
  }

  // Check each unique image (limit concurrency to avoid rate limits)
  const BATCH_SIZE = 5;
  for (let i = 0; i < uniqueImages.length; i += BATCH_SIZE) {
    const batch = uniqueImages.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((img) => checkImageStaleness(img.name, img.tag, img.registry, img.digest)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        upsertStalenessRecord(result.value);
        checked++;
        if (result.value.isStale) staleCount++;
      }
    }
  }

  log.info({ checked, stale: staleCount }, 'Staleness check completed');
  return { checked, stale: staleCount };
}
