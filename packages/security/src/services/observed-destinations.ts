import { isIPv4 } from 'node:net';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('observed-destinations');

export type Verdict = 'allow' | 'warn' | 'deny';

export interface ObservedDestination {
  peer: string;
  port: number | null;
  callCount: number;
  firstSeen: string;
  lastSeen: string;
  verdict: Verdict;
  reason: string | null;
}

export interface AggregateOptions {
  from: Date;
  to: Date;
  endpointId?: number;
}

interface RuleRow {
  pattern: string;
  pattern_type: 'cidr' | 'suffix';
  verdict: Verdict;
  reason: string | null;
}

interface CidrRule {
  pattern: string;
  base: number;
  mask: number;
  verdict: Verdict;
  reason: string | null;
}

interface SuffixRule {
  pattern: string;
  suffix: string;
  verdict: Verdict;
  reason: string | null;
}

/**
 * Parse an IPv4 dotted-quad into a 32-bit unsigned integer. Returns null
 * for inputs that aren't IPv4 literals.
 */
function ipv4ToInt(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  const parts = ip.split('.').map((x) => Number(x));
  if (parts.length !== 4) return null;
  // unsigned 32-bit math
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Parse "10.0.0.0/8" into a numeric base + mask used for `base === ip & mask`. */
function parseCidr(pattern: string): { base: number; mask: number } | null {
  const [ip, bitsRaw] = pattern.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ipInt & mask) >>> 0, mask };
}

async function loadRules(): Promise<{ cidrs: CidrRule[]; suffixes: SuffixRule[] }> {
  // All domains map to the same Postgres pool; 'settings' is the closest
  // semantic label for a configuration table like this.
  const db = getDbForDomain('settings');
  const rows = await db.query<RuleRow>(
    `SELECT pattern, pattern_type, verdict, reason
       FROM security_destination_rules`,
  );
  const cidrs: CidrRule[] = [];
  const suffixes: SuffixRule[] = [];
  for (const row of rows) {
    if (row.pattern_type === 'cidr') {
      const parsed = parseCidr(row.pattern);
      if (!parsed) {
        log.warn({ pattern: row.pattern }, 'invalid CIDR rule, skipping');
        continue;
      }
      cidrs.push({ pattern: row.pattern, base: parsed.base, mask: parsed.mask, verdict: row.verdict, reason: row.reason });
    } else {
      suffixes.push({ pattern: row.pattern, suffix: row.pattern.toLowerCase(), verdict: row.verdict, reason: row.reason });
    }
  }
  return { cidrs, suffixes };
}

/** Pick the most-specific verdict for a peer; deny > allow > warn ordering. */
function classify(
  peer: string,
  rules: { cidrs: CidrRule[]; suffixes: SuffixRule[] },
): { verdict: Verdict; reason: string | null } {
  const lower = peer.toLowerCase();
  const ipInt = ipv4ToInt(peer);
  let matched: { verdict: Verdict; reason: string | null } | null = null;
  let matchedSpecificity = -1; // higher wins (more specific prefix)

  if (ipInt !== null) {
    for (const rule of rules.cidrs) {
      if (((ipInt & rule.mask) >>> 0) === rule.base) {
        // Use popcount of mask as specificity (CIDR /32 wins over /8).
        let popcount = 0;
        let m = rule.mask;
        while (m) { popcount += m & 1; m >>>= 1; }
        if (popcount > matchedSpecificity) {
          matched = { verdict: rule.verdict, reason: rule.reason };
          matchedSpecificity = popcount;
        }
      }
    }
  } else {
    for (const rule of rules.suffixes) {
      if (lower.endsWith(rule.suffix)) {
        // Longest suffix wins.
        if (rule.suffix.length > matchedSpecificity) {
          matched = { verdict: rule.verdict, reason: rule.reason };
          matchedSpecificity = rule.suffix.length;
        }
      }
    }
  }

  if (matched) return matched;
  return { verdict: 'warn', reason: null };
}

interface RawRow {
  peer: string;
  port: number | null;
  call_count: string | number;
  first_seen: string | Date;
  last_seen: string | Date;
}

export async function aggregateObservedDestinations(opts: AggregateOptions): Promise<ObservedDestination[]> {
  const db = getDbForDomain('traces');
  const params: unknown[] = [opts.from.toISOString(), opts.to.toISOString()];
  const sql = `
    SELECT
      COALESCE(net_peer_name, server_address) AS peer,
      COALESCE(net_peer_port, server_port) AS port,
      count(*)::int AS call_count,
      min(start_time) AS first_seen,
      max(start_time) AS last_seen
    FROM spans
    WHERE start_time >= ? AND start_time < ?
      AND COALESCE(net_peer_name, server_address) IS NOT NULL
    GROUP BY peer, port
    ORDER BY call_count DESC
    LIMIT 200
  `;
  const rows = await db.query<RawRow>(sql, params);
  if (rows.length === 0) return [];

  const rules = await loadRules();
  return rows.map((r) => {
    const { verdict, reason } = classify(r.peer, rules);
    return {
      peer: r.peer,
      port: r.port != null ? Number(r.port) : null,
      callCount: Number(r.call_count),
      firstSeen: r.first_seen instanceof Date ? r.first_seen.toISOString() : String(r.first_seen),
      lastSeen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
      verdict,
      reason,
    };
  });
}
