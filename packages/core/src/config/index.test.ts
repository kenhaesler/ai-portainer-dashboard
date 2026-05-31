import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('config validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PORTAINER_API_KEY = 'test-portainer-api-key';
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'replace-with-strong-random-passphrase';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
    vi.resetModules();
  });

  it('rejects missing JWT_SECRET', async () => {
    delete process.env.JWT_SECRET;

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_SECRET/i);
  });

  it('rejects known weak JWT secret values in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-32-chars';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/insecure JWT secret/i);
  });

  it('rejects placeholder JWT secret in production', async () => {
    process.env.NODE_ENV = 'production';
    // Exact blocklist entry (32 chars minimum satisfied by the string itself)
    process.env.JWT_SECRET = 'generate-a-random-64-char-string';
    process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';
    process.env.TIMESCALE_URL = 'postgresql://metrics_user:str0ng-ts-p4ss@timescaledb:5432/metrics';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/insecure JWT secret/i);
  });

  it('allows weak JWT secret in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-32-chars';

    const { getConfig } = await import('./index.js');
    const config = getConfig();
    expect(config.JWT_SECRET).toBe(process.env.JWT_SECRET);
  });

  it('rejects missing dashboard credentials', async () => {
    delete process.env.DASHBOARD_USERNAME;
    delete process.env.DASHBOARD_PASSWORD;

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/DASHBOARD_USERNAME|DASHBOARD_PASSWORD/i);
  });

  it('rejects weak dashboard passwords in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DASHBOARD_USERNAME = 'operator';
    process.env.DASHBOARD_PASSWORD = 'password12345';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/weak dashboard password/i);
  });

  it('rejects changeme+digit variants in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DASHBOARD_PASSWORD = 'changeme123456';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/weak dashboard password/i);
  });

  it('rejects changeme1234567890 in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DASHBOARD_PASSWORD = 'changeme1234567890';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/weak dashboard password/i);
  });

  it('allows weak dashboard passwords in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'changeme12345';

    const { getConfig } = await import('./index.js');
    const config = getConfig();
    expect(config.DASHBOARD_PASSWORD).toBe('changeme12345');
  });

  it('accepts secure auth secrets and credentials', async () => {
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'replace-with-strong-random-passphrase';
    process.env.JWT_SECRET = 'this-is-a-very-strong-jwt-secret-with-32-plus-chars';

    const { getConfig } = await import('./index.js');
    const config = getConfig();
    expect(config.DASHBOARD_USERNAME).toBe('admin');
    expect(config.DASHBOARD_PASSWORD).toBe('replace-with-strong-random-passphrase');
    expect(config.JWT_SECRET).toBe(process.env.JWT_SECRET);
  });

  describe('Shannon entropy validation (production only)', () => {
    it('rejects low-entropy passwords in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DASHBOARD_PASSWORD = 'aaaaaaaaaaaa'; // entropy = 0

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/password entropy too low/i);
    });

    it('accepts high-entropy passwords in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';
      process.env.REDIS_PASSWORD = 'strong-redis-pass-2024';
      process.env.TIMESCALE_URL = 'postgresql://metrics_user:str0ng-ts-p4ss@timescaledb:5432/metrics';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.DASHBOARD_PASSWORD).toBe('xK9#mP2$vL7@nQ4!');
    });

    it('skips entropy check in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DASHBOARD_PASSWORD = 'aaaaaaaaaaaa';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.DASHBOARD_PASSWORD).toBe('aaaaaaaaaaaa');
    });
  });

  describe('shannonEntropy function', () => {
    it('returns 0 for empty string', async () => {
      const { shannonEntropy } = await import('./index.js');
      expect(shannonEntropy('')).toBe(0);
    });

    it('returns 0 for single repeated character', async () => {
      const { shannonEntropy } = await import('./index.js');
      expect(shannonEntropy('aaaaaaa')).toBe(0);
    });

    it('returns 1 for two equally distributed characters', async () => {
      const { shannonEntropy } = await import('./index.js');
      expect(shannonEntropy('ab')).toBeCloseTo(1.0, 5);
    });

    it('returns high entropy for diverse characters', async () => {
      const { shannonEntropy } = await import('./index.js');
      const entropy = shannonEntropy('xK9#mP2$vL7@nQ4!');
      expect(entropy).toBeGreaterThan(3.5);
    });

    it('returns low entropy for repeated patterns', async () => {
      const { shannonEntropy } = await import('./index.js');
      const entropy = shannonEntropy('abcabcabcabc');
      expect(entropy).toBeLessThan(2.0);
    });
  });

  describe('service password validation (production only)', () => {
    it('rejects weak Redis password in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_PASSWORD = 'changeme-redis';
      process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/weak Redis password/i);
    });

    it('rejects weak TimescaleDB password in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TIMESCALE_URL = 'postgresql://metrics_user:changeme-timescale@timescaledb:5432/metrics';
      process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/weak TimescaleDB password/i);
    });

    it('accepts weak Redis password in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_PASSWORD = 'changeme-redis';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.REDIS_PASSWORD).toBe('changeme-redis');
    });

    it('accepts weak TimescaleDB password in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.TIMESCALE_URL = 'postgresql://metrics_user:changeme-timescale@timescaledb:5432/metrics';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.TIMESCALE_URL).toContain('changeme-timescale');
    });

    it('accepts strong Redis password in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_PASSWORD = 'a-very-strong-redis-password-2024';
      process.env.TIMESCALE_URL = 'postgresql://metrics_user:str0ng-ts-p4ss@timescaledb:5432/metrics';
      process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.REDIS_PASSWORD).toBe('a-very-strong-redis-password-2024');
    });

    it('accepts strong TimescaleDB password in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TIMESCALE_URL = 'postgresql://metrics_user:str0ng-ts-p4ss@timescaledb:5432/metrics';
      process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.TIMESCALE_URL).toContain('str0ng-ts-p4ss');
    });

    it('skips TimescaleDB check when URL has no password', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_PASSWORD = 'a-very-strong-redis-password-2024';
      process.env.TIMESCALE_URL = 'postgresql://metrics_user@timescaledb:5432/metrics';
      process.env.DASHBOARD_PASSWORD = 'xK9#mP2$vL7@nQ4!';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.TIMESCALE_URL).toBeDefined();
    });
  });

  describe('monitoring timing defaults', () => {
    it('defaults ANOMALY_ZSCORE_THRESHOLD to 3.5', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_ZSCORE_THRESHOLD).toBe(3.5);
    });

    it('defaults ANOMALY_MIN_SAMPLES to 10', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_MIN_SAMPLES).toBe(10);
    });

    it('defaults ANOMALY_DETECTION_DIRECTION to spike (#1361 — one-sided)', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_DETECTION_DIRECTION).toBe('spike');
    });

    it('defaults ANOMALY_DETECTION_METHOD to robust-mad (#1362)', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_DETECTION_METHOD).toBe('robust-mad');
    });

    it('defaults ANOMALY_MOVING_AVERAGE_WINDOW to 60', async () => {
      // Raised 20 → 60 in #1294 (epic #1291): the previous ~20-min window
      // over-reacted to traffic ramps and short-lived bursts.
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_MOVING_AVERAGE_WINDOW).toBe(60);
    });

    it('defaults ANOMALY_COOLDOWN_MINUTES to 30', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_COOLDOWN_MINUTES).toBe(30);
    });

    it('defaults ANOMALY_HARD_THRESHOLD_ENABLED to true', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_HARD_THRESHOLD_ENABLED).toBe(true);
    });

    it('defaults BOLLINGER_BANDS_ENABLED to true', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().BOLLINGER_BANDS_ENABLED).toBe(true);
    });

    it('defaults ANOMALY_THRESHOLD_PCT to 85', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_THRESHOLD_PCT).toBe(85);
    });

    it('defaults ANOMALY_EXPLANATION_MAX_PER_CYCLE to 5', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_EXPLANATION_MAX_PER_CYCLE).toBe(5);
    });

    it('defaults ISOLATION_FOREST_CONTAMINATION to 0.05', async () => {
      // Lowered 0.15 → 0.05 in #1294 (epic #1291): the previous value
      // forced ~15% of every stable workload's readings into the anomaly
      // class by construction.
      const { getConfig } = await import('./index.js');
      expect(getConfig().ISOLATION_FOREST_CONTAMINATION).toBe(0.05);
    });

    it('defaults INVESTIGATION_COOLDOWN_MINUTES to 20', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().INVESTIGATION_COOLDOWN_MINUTES).toBe(20);
    });

    it('defaults ISOLATION_FOREST_RETRAIN_HOURS to 6', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ISOLATION_FOREST_RETRAIN_HOURS).toBe(6);
    });
  });

  describe('JWT_ALGORITHM validation', () => {
    it('defaults to HS256 when JWT_ALGORITHM is not set', async () => {
      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.JWT_ALGORITHM).toBe('HS256');
    });

    it('accepts HS256 explicitly', async () => {
      process.env.JWT_ALGORITHM = 'HS256';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.JWT_ALGORITHM).toBe('HS256');
    });

    it('rejects invalid JWT_ALGORITHM values', async () => {
      process.env.JWT_ALGORITHM = 'HS384';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_ALGORITHM/i);
    });

    it('rejects RS256 without key paths', async () => {
      process.env.JWT_ALGORITHM = 'RS256';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_PRIVATE_KEY_PATH.*JWT_PUBLIC_KEY_PATH/i);
    });

    it('rejects ES256 without key paths', async () => {
      process.env.JWT_ALGORITHM = 'ES256';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_PRIVATE_KEY_PATH.*JWT_PUBLIC_KEY_PATH/i);
    });

    it('rejects RS256 with missing private key file', async () => {
      process.env.JWT_ALGORITHM = 'RS256';
      process.env.JWT_PRIVATE_KEY_PATH = '/nonexistent/private.pem';
      process.env.JWT_PUBLIC_KEY_PATH = '/nonexistent/public.pem';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_PRIVATE_KEY_PATH.*file not found/i);
    });
  });

  describe('deprecated env var warnings', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('logs a warning when a deprecated env var is set', async () => {
      process.env.MONITORING_ENABLED = 'true';

      const { getConfig } = await import('./index.js');
      getConfig();

      const monitoringWarning = warnSpy.mock.calls.find((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('MONITORING_ENABLED'),
      );
      expect(monitoringWarning).toBeDefined();
      expect(monitoringWarning![0]).toContain('[DEPRECATED]');
      expect(monitoringWarning![0]).toContain('Settings');
    });

    it('logs a warning for MONITORING_INTERVAL_MINUTES when set', async () => {
      process.env.MONITORING_INTERVAL_MINUTES = '10';

      const { getConfig } = await import('./index.js');
      getConfig();

      const intervalWarning = warnSpy.mock.calls.find((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('MONITORING_INTERVAL_MINUTES'),
      );
      expect(intervalWarning).toBeDefined();
      expect(intervalWarning![0]).toContain('[DEPRECATED]');
    });

    it('does not log warnings for deprecated vars that are not set', async () => {
      delete process.env.MONITORING_ENABLED;
      delete process.env.MONITORING_INTERVAL_MINUTES;
      delete process.env.TEAMS_WEBHOOK_URL;

      const { getConfig } = await import('./index.js');
      getConfig();

      const deprecatedWarnings = warnSpy.mock.calls.filter((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('[DEPRECATED]'),
      );
      // Should have no warnings for the vars we explicitly deleted.
      // (Other deprecated vars may be set from the test env, so just check the specific ones.)
      const monitoringWarnings = deprecatedWarnings.filter((call: unknown[]) =>
        (call[0] as string).includes('MONITORING_ENABLED') || (call[0] as string).includes('MONITORING_INTERVAL_MINUTES'),
      );
      expect(monitoringWarnings).toHaveLength(0);
    });

    it('includes all expected vars in DEPRECATED_ENV_VARS', async () => {
      const { DEPRECATED_ENV_VARS } = await import('./index.js');

      // Monitoring vars added in #1043
      expect(DEPRECATED_ENV_VARS).toHaveProperty('MONITORING_ENABLED');
      expect(DEPRECATED_ENV_VARS).toHaveProperty('MONITORING_INTERVAL_MINUTES');

      // Existing notification vars
      expect(DEPRECATED_ENV_VARS).toHaveProperty('TEAMS_WEBHOOK_URL');
      expect(DEPRECATED_ENV_VARS).toHaveProperty('EMAIL_NOTIFICATIONS_ENABLED');
      expect(DEPRECATED_ENV_VARS).toHaveProperty('WEBHOOKS_ENABLED');

      // AI tuning vars
      expect(DEPRECATED_ENV_VARS).toHaveProperty('ANOMALY_ZSCORE_THRESHOLD');
      expect(DEPRECATED_ENV_VARS).toHaveProperty('ISOLATION_FOREST_ENABLED');

      // SMTP_HOST must NOT be in deprecated list (env-only for SSRF protection)
      expect(DEPRECATED_ENV_VARS).not.toHaveProperty('SMTP_HOST');

      // Isolation Forest structural params must NOT be deprecated (env-only tuning)
      expect(DEPRECATED_ENV_VARS).not.toHaveProperty('ISOLATION_FOREST_TREES');
      expect(DEPRECATED_ENV_VARS).not.toHaveProperty('ISOLATION_FOREST_SAMPLE_SIZE');
      expect(DEPRECATED_ENV_VARS).not.toHaveProperty('ISOLATION_FOREST_CONTAMINATION');
    });
  });

  // ── #1115: CORS_ALLOWED_ORIGINS Zod validation ──────────────────────────
  describe('CORS_ALLOWED_ORIGINS validation', () => {
    it('accepts a comma-separated list of valid origins', async () => {
      process.env.CORS_ALLOWED_ORIGINS =
        'https://example.com,https://other.example.com:8443,http://localhost:5273';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.CORS_ALLOWED_ORIGINS).toBe(
        'https://example.com,https://other.example.com:8443,http://localhost:5273',
      );
    });

    it('accepts an unset value (legacy default — no cross-origin in production)', async () => {
      delete process.env.CORS_ALLOWED_ORIGINS;

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.CORS_ALLOWED_ORIGINS).toBeUndefined();
    });

    it('rejects an entry without a protocol', async () => {
      process.env.CORS_ALLOWED_ORIGINS = 'example.com';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(
        /CORS_ALLOWED_ORIGINS.*protocol:\/\/host/i,
      );
    });

    it('rejects an entry with a path component', async () => {
      process.env.CORS_ALLOWED_ORIGINS = 'https://example.com/path';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(
        /CORS_ALLOWED_ORIGINS.*protocol:\/\/host/i,
      );
    });

    it('rejects a mixed list when any single entry is invalid', async () => {
      process.env.CORS_ALLOWED_ORIGINS = 'https://example.com,not-a-url';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(
        /CORS_ALLOWED_ORIGINS.*protocol:\/\/host/i,
      );
    });
  });

  // ── #1108: HSTS_PRELOAD env var ────────────────────────────────────────
  describe('HSTS_PRELOAD validation', () => {
    it('defaults to false when unset', async () => {
      delete process.env.HSTS_PRELOAD;

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.HSTS_PRELOAD).toBe(false);
    });

    it('accepts string "true" and coerces to boolean', async () => {
      process.env.HSTS_PRELOAD = 'true';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.HSTS_PRELOAD).toBe(true);
    });
  });
});

describe('JWT_TOKEN_EXPIRY_MINUTES (issue #1106)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PORTAINER_API_KEY = 'test-portainer-api-key';
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'replace-with-strong-random-passphrase';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to 60 minutes when unset (preserves prior behavior)', async () => {
    delete process.env.JWT_TOKEN_EXPIRY_MINUTES;

    const { getConfig } = await import('./index.js');
    expect(getConfig().JWT_TOKEN_EXPIRY_MINUTES).toBe(60);
  });

  it('accepts the lower bound of 5 minutes', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '5';

    const { getConfig } = await import('./index.js');
    expect(getConfig().JWT_TOKEN_EXPIRY_MINUTES).toBe(5);
  });

  it('rejects values below 5 minutes', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '4';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });

  it('accepts the upper bound of 1440 minutes', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '1440';

    const { getConfig } = await import('./index.js');
    expect(getConfig().JWT_TOKEN_EXPIRY_MINUTES).toBe(1440);
  });

  it('rejects values above 1440 minutes', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '1441';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });

  it('rejects non-integer (fractional) values', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '60.5';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });

  it('rejects non-numeric values', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = 'sixty';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });

  it('rejects zero', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '0';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });

  it('rejects negative values', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '-30';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });
});
