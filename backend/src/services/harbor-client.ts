import { Agent, fetch as undiciFetch } from 'undici';
import pLimit from 'p-limit';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { withSpan } from './trace-context.js';
import { getEffectiveHarborConfig } from './settings-store.js';

const log = createChildLogger('harbor-client');

// ---------------------------------------------------------------------------
// Types — based on Harbor v2.14.2 swagger.yaml
// ---------------------------------------------------------------------------

export interface HarborProject {
  project_id: number;
  name: string;
  repo_count: number;
  metadata?: {
    auto_scan?: string;
    severity?: string;
    prevent_vul?: string;
    reuse_sys_cve_allowlist?: string;
  };
  cve_allowlist?: HarborCVEAllowlist;
}

export interface HarborRepository {
  id: number;
  name: string;
  artifact_count: number;
  project_id: number;
}

export interface HarborArtifact {
  id: number;
  digest: string;
  tags?: Array<{ name: string }>;
  scan_overview?: Record<string, HarborNativeReportSummary>;
}

export interface HarborNativeReportSummary {
  report_id: string;
  scan_status: string;
  severity: string;
  duration: number;
  summary: {
    total: number;
    fixable: number;
    summary: Record<string, number>;
  };
  start_time: string;
  end_time: string;
  complete_percent: number;
}

export interface HarborVulnerabilityItem {
  project_id: number;
  repository_name: string;
  digest: string;
  tags?: string[];
  cve_id: string;
  severity: string;
  status: string;
  cvss_v3_score: number;
  package: string;
  version: string;
  fixed_version: string;
  desc: string;
  links?: string[];
}

export interface HarborSecuritySummary {
  critical_cnt: number;
  high_cnt: number;
  medium_cnt: number;
  low_cnt: number;
  none_cnt: number;
  unknown_cnt: number;
  total_vuls: number;
  scanned_cnt: number;
  total_artifact: number;
  fixable_cnt: number;
  dangerous_cves?: Array<{
    cve_id: string;
    severity: string;
    cvss_score_v3: number;
    desc: string;
    package: string;
    version: string;
  }>;
  dangerous_artifacts?: Array<{
    project_id: number;
    repository_name: string;
    digest: string;
    critical_cnt: number;
    high_cnt: number;
    medium_cnt: number;
  }>;
}

export interface HarborCVEAllowlist {
  id?: number;
  project_id?: number;
  expires_at?: number | null;
  items?: Array<{ cve_id: string }>;
  creation_time?: string;
  update_time?: string;
}

// ---------------------------------------------------------------------------
// Resolved config type (DB settings with env var fallback)
// ---------------------------------------------------------------------------

interface ResolvedHarborConfig {
  apiUrl: string;
  robotName: string;
  robotSecret: string;
  verifySsl: boolean;
  concurrency: number;
}

async function resolveConfig(): Promise<ResolvedHarborConfig> {
  const effective = await getEffectiveHarborConfig();
  const envConfig = getConfig();
  return {
    apiUrl: effective.apiUrl || '',
    robotName: effective.robotName || '',
    robotSecret: effective.robotSecret || '',
    verifySsl: effective.verifySsl,
    concurrency: envConfig.HARBOR_CONCURRENCY,
  };
}

// ---------------------------------------------------------------------------
// Client internals
// ---------------------------------------------------------------------------

let limiter: ReturnType<typeof pLimit> | undefined;
let limiterConcurrency: number | undefined;
function getLimiter(concurrency: number): ReturnType<typeof pLimit> {
  if (!limiter || limiterConcurrency !== concurrency) {
    limiter = pLimit(concurrency);
    limiterConcurrency = concurrency;
  }
  return limiter;
}

let pooledDispatcher: Agent | undefined;
let lastVerifySsl: boolean | undefined;
function getDispatcher(verifySsl: boolean): Agent | undefined {
  if (pooledDispatcher && lastVerifySsl === verifySsl) return pooledDispatcher;
  // Recreate dispatcher when SSL setting changes
  if (pooledDispatcher) {
    pooledDispatcher.close().catch(() => {});
    pooledDispatcher = undefined;
  }
  const connectOptions: Record<string, unknown> = {};
  if (!verifySsl) {
    connectOptions.rejectUnauthorized = false;
    log.warn('Harbor SSL verification is disabled (verifySsl=false). Connections are not verified. Only use this in trusted environments.');
  }
  pooledDispatcher = new Agent({
    connections: 10,
    pipelining: 1,
    ...(Object.keys(connectOptions).length > 0 && { connect: connectOptions }),
  });
  lastVerifySsl = verifySsl;
  return pooledDispatcher;
}

export class HarborError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HarborError';
  }
}

/** Exported for testing — resets cached state */
export function _resetHarborClientState(): void {
  limiter = undefined;
  limiterConcurrency = undefined;
  pooledDispatcher = undefined;
  lastVerifySsl = undefined;
}

function buildUrl(apiUrl: string, path: string): string {
  if (!apiUrl) throw new HarborError('HARBOR_API_URL is not configured');
  const base = apiUrl.replace(/\/+$/, '');
  return `${base}/api/v2.0${path}`;
}

function buildHeaders(robotName: string, robotSecret: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (robotName && robotSecret) {
    const credentials = Buffer.from(
      `${robotName}:${robotSecret}`,
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }
  return headers;
}

/** Sync check using env vars only (kept for backward compatibility). */
export function isHarborConfigured(): boolean {
  const config = getConfig();
  return !!(config.HARBOR_API_URL && config.HARBOR_ROBOT_NAME && config.HARBOR_ROBOT_SECRET);
}

/** Async check merging settings DB with env vars. */
export async function isHarborConfiguredAsync(): Promise<boolean> {
  const cfg = await getEffectiveHarborConfig();
  return !!(cfg.apiUrl && cfg.robotName && cfg.robotSecret);
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
  query?: Record<string, string | number | boolean>;
}

async function harborFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', timeout = 15000 } = options;
  const cfg = await resolveConfig();
  return getLimiter(cfg.concurrency)(() =>
    withSpan(`harbor ${method} ${path}`, 'harbor-api', 'client', () =>
      harborFetchInner<T>(path, options, timeout, cfg),
    ),
  );
}

async function harborFetchInner<T>(
  path: string,
  options: FetchOptions,
  timeout: number,
  cfg: ResolvedHarborConfig,
): Promise<T> {
  const { method = 'GET', body, query } = options;

  let url = buildUrl(cfg.apiUrl, path);
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const dispatcher = getDispatcher(cfg.verifySsl);
  const response = await undiciFetch(url, {
    method,
    headers: buildHeaders(cfg.robotName, cfg.robotSecret),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
    ...(dispatcher && { dispatcher }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HarborError(
      `Harbor API ${method} ${path} returned ${response.status}: ${text}`,
      response.status,
    );
  }

  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
}

async function harborFetchPaginated<T>(
  path: string,
  query: Record<string, string | number | boolean> = {},
  maxPages = 10,
): Promise<PaginatedResult<T>> {
  const cfg = await resolveConfig();
  const pageSize = 100;
  const allItems: T[] = [];
  let total = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildUrl(cfg.apiUrl, path);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    const fullUrl = `${url}?${params.toString()}`;

    const dispatcher = getDispatcher(cfg.verifySsl);
    const response = await getLimiter(cfg.concurrency)(() =>
      withSpan(`harbor GET ${path} page=${page}`, 'harbor-api', 'client', async () => {
        const res = await undiciFetch(fullUrl, {
          method: 'GET',
          headers: buildHeaders(cfg.robotName, cfg.robotSecret),
          signal: AbortSignal.timeout(15000),
          ...(dispatcher && { dispatcher }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new HarborError(`Harbor API GET ${path} returned ${res.status}: ${text}`, res.status);
        }
        const totalHeader = res.headers.get('x-total-count');
        const items = (await res.json()) as T[];
        return { items, total: totalHeader ? parseInt(totalHeader, 10) : 0 };
      }),
    );

    allItems.push(...response.items);
    if (page === 1) total = response.total;

    if (allItems.length >= total || response.items.length < pageSize) break;
  }

  return { items: allItems, total };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Test Harbor connectivity and credentials */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await harborFetch<HarborSecuritySummary>('/security/summary');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.warn({ err }, 'Harbor connection test failed');
    return { ok: false, error: msg };
  }
}

/** Get system-wide security summary */
export async function getSecuritySummary(): Promise<HarborSecuritySummary> {
  return harborFetch<HarborSecuritySummary>('/security/summary', {
    query: { with_dangerous_cve: true, with_dangerous_artifact: true },
  });
}

/** List all projects */
export async function getProjects(): Promise<HarborProject[]> {
  const result = await harborFetchPaginated<HarborProject>('/projects', { with_detail: true });
  return result.items;
}

/** List repositories in a project */
export async function getRepositories(projectName: string): Promise<HarborRepository[]> {
  const result = await harborFetchPaginated<HarborRepository>(
    `/projects/${encodeURIComponent(projectName)}/repositories`,
  );
  return result.items;
}

/** List artifacts with scan overview */
export async function getArtifacts(
  projectName: string,
  repositoryName: string,
): Promise<HarborArtifact[]> {
  // Repository name in Harbor includes the project prefix, strip it for the URL path
  const repoPath = repositoryName.includes('/')
    ? repositoryName.split('/').slice(1).join('/')
    : repositoryName;
  const result = await harborFetchPaginated<HarborArtifact>(
    `/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoPath)}/artifacts`,
    { with_scan_overview: true, with_tag: true },
  );
  return result.items;
}

/** Search vulnerabilities across all projects using Security Hub */
export async function listVulnerabilities(options: {
  severity?: string;
  cveId?: string;
  projectId?: number;
  page?: number;
  pageSize?: number;
} = {}): Promise<PaginatedResult<HarborVulnerabilityItem>> {
  const cfg = await resolveConfig();
  const query: Record<string, string | number | boolean> = {
    with_tag: true,
    tune_count: true,
  };

  // Build Harbor query filter
  const filters: string[] = [];
  if (options.severity) filters.push(`severity=${options.severity}`);
  if (options.cveId) filters.push(`cve_id=${options.cveId}`);
  if (options.projectId) filters.push(`project_id=${options.projectId}`);
  if (filters.length > 0) query['q'] = filters.join(',');

  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 100;
  query['page'] = page;
  query['page_size'] = pageSize;

  const url = buildUrl(cfg.apiUrl, '/security/vul');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    params.set(k, String(v));
  }
  const fullUrl = `${url}?${params.toString()}`;

  const dispatcher = getDispatcher(cfg.verifySsl);
  const response = await getLimiter(cfg.concurrency)(() =>
    withSpan('harbor GET /security/vul', 'harbor-api', 'client', async () => {
      const res = await undiciFetch(fullUrl, {
        method: 'GET',
        headers: buildHeaders(cfg.robotName, cfg.robotSecret),
        signal: AbortSignal.timeout(30000),
        ...(dispatcher && { dispatcher }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HarborError(`Harbor API GET /security/vul returned ${res.status}: ${text}`, res.status);
      }
      const totalHeader = res.headers.get('x-total-count');
      const items = (await res.json()) as HarborVulnerabilityItem[];
      return { items, total: totalHeader ? parseInt(totalHeader, 10) : 0 };
    }),
  );

  return response;
}

/** Get system CVE allowlist */
export async function getSystemCVEAllowlist(): Promise<HarborCVEAllowlist> {
  return harborFetch<HarborCVEAllowlist>('/system/CVEAllowlist');
}

/** Trigger a vulnerability scan on a specific artifact */
export async function triggerScan(
  projectName: string,
  repositoryName: string,
  reference: string,
): Promise<void> {
  const repoPath = repositoryName.includes('/')
    ? repositoryName.split('/').slice(1).join('/')
    : repositoryName;
  await harborFetch<void>(
    `/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoPath)}/artifacts/${encodeURIComponent(reference)}/scan`,
    { method: 'POST', body: { scan_type: 'vulnerability' } },
  );
}
