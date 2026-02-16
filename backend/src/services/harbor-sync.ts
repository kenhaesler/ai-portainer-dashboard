import { createChildLogger } from '../utils/logger.js';
import { withSpan } from './trace-context.js';
import * as harbor from './harbor-client.js';
import * as store from './harbor-vulnerability-store.js';
import { getEndpoints, getContainers } from './portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from './portainer-cache.js';
import { parseImageRef } from './image-staleness.js';
import type { VulnerabilityInsert } from './harbor-vulnerability-store.js';

const log = createChildLogger('harbor-sync');

// ---------------------------------------------------------------------------
// In-use correlation
// ---------------------------------------------------------------------------

interface RunningImage {
  registry: string;
  name: string;
  tag: string;
  containerId: string;
  containerName: string;
  endpointId: number;
}

/** Collect all images currently running across all Portainer endpoints */
async function collectRunningImages(): Promise<RunningImage[]> {
  const endpoints = await cachedFetchSWR(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => getEndpoints(),
  );

  const images: RunningImage[] = [];

  for (const ep of endpoints) {
    try {
      const containers = await cachedFetchSWR(
        getCacheKey('containers', ep.Id),
        TTL.CONTAINERS,
        () => getContainers(ep.Id),
      );

      for (const c of containers) {
        if (c.State !== 'running') continue;
        const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
        const parsed = parseImageRef(c.Image || '');
        images.push({
          ...parsed,
          containerId: c.Id,
          containerName: name,
          endpointId: ep.Id,
        });
      }
    } catch (err) {
      log.warn({ endpointId: ep.Id, err }, 'Failed to fetch containers for endpoint');
    }
  }

  return images;
}

/** Match a Harbor vulnerability's repo/tag to running Portainer containers */
function matchVulnToRunning(
  repoName: string,
  tags: string[],
  runningImages: RunningImage[],
): RunningImage[] {
  // Harbor repository_name is like "project/image" — extract the image part
  const imagePart = repoName.includes('/') ? repoName.split('/').pop()! : repoName;

  return runningImages.filter((img) => {
    // Match image name (compare the last segment)
    const imgNamePart = img.name.includes('/') ? img.name.split('/').pop()! : img.name;
    if (imgNamePart !== imagePart) return false;

    // If tags are available, match at least one
    if (tags.length > 0) {
      return tags.some((t) => t === img.tag);
    }

    // No tags to match — consider it a match by image name alone
    return true;
  });
}

// ---------------------------------------------------------------------------
// Full sync
// ---------------------------------------------------------------------------

export interface SyncResult {
  vulnerabilitiesSynced: number;
  inUseMatched: number;
  durationMs: number;
  error?: string;
}

/** Run a full vulnerability sync from Harbor → local DB with Portainer correlation */
export async function runFullSync(): Promise<SyncResult> {
  return withSpan('harbor-sync.full', 'harbor-sync', 'internal', async () => {
    const startTime = Date.now();
    const syncId = await store.createSyncStatus('full');

    try {
      if (!(await harbor.isHarborConfiguredAsync())) {
        throw new Error('Harbor is not configured — set HARBOR_API_URL, HARBOR_ROBOT_NAME, HARBOR_ROBOT_SECRET or configure via Settings UI');
      }

      log.info('Starting full Harbor vulnerability sync');

      // Step 1: Collect running container images from Portainer
      const runningImages = await collectRunningImages();
      log.debug({ runningImageCount: runningImages.length }, 'Collected running images from Portainer');

      // Step 2: Fetch all vulnerabilities from Harbor Security Hub
      const allVulns: harbor.HarborVulnerabilityItem[] = [];
      let page = 1;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const result = await harbor.listVulnerabilities({ page, pageSize });
        allVulns.push(...result.items);

        if (result.items.length < pageSize || (result.total > 0 && allVulns.length >= result.total)) {
          hasMore = false;
        } else {
          page++;
        }

        // Safety limit
        if (page > 100) {
          log.warn('Hit pagination safety limit (100 pages), stopping fetch');
          break;
        }
      }

      log.debug({ vulnCount: allVulns.length }, 'Fetched vulnerabilities from Harbor');

      // Step 3: Correlate with running containers and build insert records
      let inUseCount = 0;
      const inserts: VulnerabilityInsert[] = allVulns.map((v) => {
        const tags = v.tags ?? [];
        const matches = matchVulnToRunning(v.repository_name, tags, runningImages);
        const inUse = matches.length > 0;
        if (inUse) inUseCount++;

        return {
          cve_id: v.cve_id,
          severity: v.severity || 'Unknown',
          cvss_v3_score: v.cvss_v3_score ?? null,
          package: v.package || '',
          version: v.version || '',
          fixed_version: v.fixed_version || null,
          status: v.status || null,
          description: v.desc || null,
          links: v.links ? JSON.stringify(v.links) : null,
          project_id: v.project_id,
          repository_name: v.repository_name,
          digest: v.digest,
          tags: tags.length > 0 ? JSON.stringify(tags) : null,
          in_use: inUse,
          matching_containers: matches.length > 0
            ? JSON.stringify(matches.map((m) => ({
                id: m.containerId.slice(0, 12),
                name: m.containerName,
                endpoint: m.endpointId,
              })))
            : null,
        };
      });

      // Step 4: Replace all records in DB
      const synced = await store.replaceAllVulnerabilities(inserts);

      const durationMs = Date.now() - startTime;
      await store.completeSyncStatus(syncId, synced, inUseCount);

      log.info(
        { vulnerabilitiesSynced: synced, inUseMatched: inUseCount, durationMs },
        'Harbor vulnerability sync completed',
      );

      return { vulnerabilitiesSynced: synced, inUseMatched: inUseCount, durationMs };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await store.failSyncStatus(syncId, msg);
      const durationMs = Date.now() - startTime;

      log.error({ err, durationMs }, 'Harbor vulnerability sync failed');
      return { vulnerabilitiesSynced: 0, inUseMatched: 0, durationMs, error: msg };
    }
  });
}
