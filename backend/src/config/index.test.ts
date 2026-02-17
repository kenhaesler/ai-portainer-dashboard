import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('defaults ANOMALY_MOVING_AVERAGE_WINDOW to 20', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ANOMALY_MOVING_AVERAGE_WINDOW).toBe(20);
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

    it('defaults ISOLATION_FOREST_CONTAMINATION to 0.15', async () => {
      const { getConfig } = await import('./index.js');
      expect(getConfig().ISOLATION_FOREST_CONTAMINATION).toBe(0.15);
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
});
