import { describe, it, expect, afterEach, vi } from 'vitest';

// Kept: openid-client mock — external dependency
vi.mock('openid-client', () => ({}));

import { getEffectiveRedirectUri } from './oidc.js';
import { setConfigForTest, resetConfig } from '../config/index.js';

describe('getEffectiveRedirectUri', () => {
  afterEach(() => {
    resetConfig();
  });

  it('uses DASHBOARD_EXTERNAL_URL when set, regardless of the manual setting', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com' });
    const result = getEffectiveRedirectUri('http://stale.localhost/auth/callback');
    expect(result).toEqual({
      redirectUri: 'https://dashboard.example.com/auth/callback',
      source: 'env',
    });
  });

  it('strips trailing slashes from DASHBOARD_EXTERNAL_URL', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com///' });
    const result = getEffectiveRedirectUri('');
    expect(result.redirectUri).toBe('https://dashboard.example.com/auth/callback');
    expect(result.source).toBe('env');
  });

  it('falls back to the manual setting when DASHBOARD_EXTERNAL_URL is unset', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
    const result = getEffectiveRedirectUri('https://manual.example.com/auth/callback');
    expect(result).toEqual({
      redirectUri: 'https://manual.example.com/auth/callback',
      source: 'setting',
    });
  });

  it('trims surrounding whitespace from the manual setting', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
    const result = getEffectiveRedirectUri('  https://manual.example.com/auth/callback  ');
    expect(result.redirectUri).toBe('https://manual.example.com/auth/callback');
    expect(result.source).toBe('setting');
  });

  it('returns source "none" when neither env nor manual setting is configured', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
    const result = getEffectiveRedirectUri('');
    expect(result).toEqual({ redirectUri: '', source: 'none' });
  });

  it('treats a whitespace-only manual setting as unset', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
    const result = getEffectiveRedirectUri('   ');
    expect(result.source).toBe('none');
  });

  it('env precedence wins even when the env URL is the same as the manual setting', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com' });
    const result = getEffectiveRedirectUri('https://dashboard.example.com/auth/callback');
    expect(result.source).toBe('env');
  });
});
