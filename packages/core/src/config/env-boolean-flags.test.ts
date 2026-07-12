import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envSchema, type EnvConfig } from './env.schema.js';

/**
 * Regression tests for #1492 — boolean env flag parsing.
 *
 * The schema previously mixed two idioms: a safe string transform and
 * z.coerce.boolean(). The latter is Boolean(input), so the strings 'false'
 * and '0' coerced to TRUE — setting a documented kill-switch to 'false'
 * silently ENABLED it (CACHE_ENABLED=false kept the cache on,
 * PCAP_ENABLED=false opened the packet-capture gate, ...). Every boolean
 * flag now goes through the shared boolStr() helper:
 *
 *   - 'true' / '1'   (case-insensitive, trimmed) → true
 *   - 'false' / '0'  (case-insensitive, trimmed) → false
 *   - unset / ''     → the flag's default
 *   - anything else  → the flag's default + a console warning
 */

// Required fields with no schema defaults.
const BASE_ENV: Record<string, string> = {
  DASHBOARD_USERNAME: 'admin',
  DASHBOARD_PASSWORD: 'replace-with-strong-random-passphrase',
  JWT_SECRET: 'a'.repeat(64),
};

function parseEnv(overrides: Record<string, string> = {}): EnvConfig {
  const result = envSchema.safeParse({ ...BASE_ENV, ...overrides });
  if (!result.success) {
    throw new Error(`envSchema.safeParse failed: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Every boolean flag with its documented default. This table doubles as the
 * breaking-change record for the z.coerce.boolean() → boolStr() migration:
 * any value other than true/1/false/0 (e.g. 'yes', 'on') used to coerce to
 * true and now falls back to the default listed here.
 */
const BOOLEAN_FLAG_DEFAULTS: Record<string, boolean> = {
  PORTAINER_VERIFY_SSL: true,
  EDGE_LIVE_QUERY_ENABLED: true,
  LLM_VERIFY_SSL: true,
  MONITORING_ENABLED: true,
  AI_ANALYSIS_ENABLED: true,
  METRICS_COLLECTION_ENABLED: true,
  PROMETHEUS_METRICS_ENABLED: false,
  ANOMALY_HARD_THRESHOLD_ENABLED: true,
  ANOMALY_PERSISTENCE_ENABLED: true,
  ANOMALY_AUTOTUNE_ENABLED: false,
  BOLLINGER_BANDS_ENABLED: true,
  ANOMALY_DAYOFWEEK_ENABLED: true,
  PREDICTIVE_ALERTING_ENABLED: true,
  ANOMALY_EXPLANATION_ENABLED: true,
  ISOLATION_FOREST_ENABLED: true,
  NLP_LOG_ANALYSIS_ENABLED: true,
  SMART_GROUPING_ENABLED: true,
  INCIDENT_SUMMARY_ENABLED: true,
  INVESTIGATION_ENABLED: true,
  PCAP_ENABLED: false,
  CACHE_ENABLED: true,
  LOG_HTTP_SUCCESS: true,
  HTTP2_ENABLED: false,
  HSTS_PRELOAD: false,
  TEAMS_NOTIFICATIONS_ENABLED: false,
  DISCORD_NOTIFICATIONS_ENABLED: false,
  TELEGRAM_NOTIFICATIONS_ENABLED: false,
  SMTP_SECURE: true,
  EMAIL_NOTIFICATIONS_ENABLED: false,
  WEBHOOKS_ENABLED: false,
  HARBOR_VERIFY_SSL: true,
  HARBOR_SYNC_ENABLED: false,
  IMAGE_STALENESS_CHECK_ENABLED: true,
  LLM_PROMPT_GUARD_STRICT: true,
  PROMPT_GUARD_NEAR_MISS_ENABLED: true,
  TRACES_INGESTION_ENABLED: false,
  OTEL_EXPORTER_ENABLED: false,
  LOG_SHIPPING_ENABLED: false,
};

describe('boolean env flags (#1492)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // boolStr warns on unrecognized values via console.warn (config parses
    // before the logger exists).
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('covers every boolean flag in the schema (new flags must be added to the table)', () => {
    const baseline = parseEnv();
    const booleanKeys = Object.entries(baseline)
      .filter(([, value]) => typeof value === 'boolean')
      .map(([key]) => key)
      .sort();

    expect(booleanKeys).toEqual(Object.keys(BOOLEAN_FLAG_DEFAULTS).sort());
  });

  it('preserves every flag default from before the migration', () => {
    const baseline = parseEnv();
    for (const [key, expected] of Object.entries(BOOLEAN_FLAG_DEFAULTS)) {
      expect(baseline[key as keyof EnvConfig], key).toBe(expected);
    }
  });

  // Table-driven parse semantics, applied to EVERY boolean flag so newly
  // added flags are covered automatically via the completeness test above.
  const cases: Array<{ input: string; expected: 'true' | 'false' | 'default' }> = [
    { input: 'true', expected: 'true' },
    { input: '1', expected: 'true' },
    { input: 'TRUE', expected: 'true' },
    { input: ' true ', expected: 'true' },
    { input: 'false', expected: 'false' },
    { input: '0', expected: 'false' },
    { input: 'False', expected: 'false' },
    { input: ' FALSE ', expected: 'false' },
    { input: '', expected: 'default' },
    { input: 'yes', expected: 'default' },
    { input: 'on', expected: 'default' },
  ];

  it.each(cases)('parses $input → $expected for every boolean flag', ({ input, expected }) => {
    const overrides = Object.fromEntries(
      Object.keys(BOOLEAN_FLAG_DEFAULTS).map((key) => [key, input]),
    );
    const parsed = parseEnv(overrides);

    for (const [key, defaultValue] of Object.entries(BOOLEAN_FLAG_DEFAULTS)) {
      const want = expected === 'default' ? defaultValue : expected === 'true';
      expect(parsed[key as keyof EnvConfig], key).toBe(want);
    }
  });

  it('warns on unrecognized values (documented fallback-to-default policy)', () => {
    parseEnv({ CACHE_ENABLED: 'yes' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unrecognized boolean value "yes"'),
    );
  });

  it('does not warn for recognized values or unset flags', () => {
    parseEnv({ CACHE_ENABLED: 'false', PCAP_ENABLED: 'TRUE' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── Explicit kill-switch regressions ─────────────────────────────────────
  // Before the fix, all of these parsed to TRUE (Boolean('false') === true).

  it('CACHE_ENABLED=false disables the cache', () => {
    expect(parseEnv({ CACHE_ENABLED: 'false' }).CACHE_ENABLED).toBe(false);
  });

  it('PCAP_ENABLED=false keeps packet capture off (observer-first)', () => {
    expect(parseEnv({ PCAP_ENABLED: 'false' }).PCAP_ENABLED).toBe(false);
  });

  it('ANOMALY_DAYOFWEEK_ENABLED=false disables the day-of-week baseline (documented opt-out)', () => {
    expect(parseEnv({ ANOMALY_DAYOFWEEK_ENABLED: 'false' }).ANOMALY_DAYOFWEEK_ENABLED).toBe(false);
  });

  it('ANOMALY_AUTOTUNE_ENABLED=false keeps threshold auto-tune off (observer-first)', () => {
    expect(parseEnv({ ANOMALY_AUTOTUNE_ENABLED: 'false' }).ANOMALY_AUTOTUNE_ENABLED).toBe(false);
  });

  it('WEBHOOKS_ENABLED=false keeps the webhook listener off', () => {
    expect(parseEnv({ WEBHOOKS_ENABLED: 'false' }).WEBHOOKS_ENABLED).toBe(false);
  });

  it('PROMETHEUS_METRICS_ENABLED=false (the shipped .env.example value) keeps /metrics off', () => {
    expect(parseEnv({ PROMETHEUS_METRICS_ENABLED: 'false' }).PROMETHEUS_METRICS_ENABLED).toBe(false);
  });

  it('MONITORING_ENABLED=0 disables monitoring via the compose-forwarded string', () => {
    expect(parseEnv({ MONITORING_ENABLED: '0' }).MONITORING_ENABLED).toBe(false);
  });

  it('HTTP2_ENABLED=false stays off in the parsed config consumed by getHttp2Options', () => {
    expect(parseEnv({ HTTP2_ENABLED: 'false' }).HTTP2_ENABLED).toBe(false);
  });
});
