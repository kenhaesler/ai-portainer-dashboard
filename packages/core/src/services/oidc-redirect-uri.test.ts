import { describe, it, expect, afterEach, vi } from 'vitest';

// Kept: openid-client mock — external dependency
vi.mock('openid-client', () => ({}));

import { getEffectiveRedirectUri, isOIDCConfigEnabled, type OIDCConfig } from './oidc.js';
import { setConfigForTest, resetConfig } from '../config/index.js';

const fullConfig: OIDCConfig = {
  enabled: true,
  issuer_url: 'https://idp.example.com',
  client_id: 'client',
  client_secret: 'secret',
  redirect_uri: '',
  scopes: 'openid profile email',
  local_auth_enabled: true,
  groups_claim: 'groups',
  group_role_mappings: {},
  auto_provision: true,
  allow_insecure_transport: false,
};

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

  it('preserves sub-paths in DASHBOARD_EXTERNAL_URL', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://example.com/dashboard' });
    const result = getEffectiveRedirectUri('');
    expect(result.redirectUri).toBe('https://example.com/dashboard/auth/callback');
  });

  it('strips query and fragment from DASHBOARD_EXTERNAL_URL', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://example.com/dashboard?foo=bar#section' });
    const result = getEffectiveRedirectUri('');
    expect(result.redirectUri).toBe('https://example.com/dashboard/auth/callback');
  });

  it('preserves a non-default port in DASHBOARD_EXTERNAL_URL', () => {
    setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'http://192.168.178.20:3051' });
    const result = getEffectiveRedirectUri('');
    expect(result.redirectUri).toBe('http://192.168.178.20:3051/auth/callback');
  });
});

describe('isOIDCConfigEnabled', () => {
  it('returns true when all credentials and a redirect URI are present', () => {
    expect(isOIDCConfigEnabled(fullConfig, 'https://dashboard.example.com/auth/callback')).toBe(true);
  });

  it('returns false when the redirect URI is empty', () => {
    expect(isOIDCConfigEnabled(fullConfig, '')).toBe(false);
  });

  it('returns false when enabled flag is off', () => {
    expect(isOIDCConfigEnabled({ ...fullConfig, enabled: false }, 'https://x/auth/callback')).toBe(false);
  });

  it('returns false when issuer_url is missing', () => {
    expect(isOIDCConfigEnabled({ ...fullConfig, issuer_url: '' }, 'https://x/auth/callback')).toBe(false);
  });

  it('returns false when client_id is missing', () => {
    expect(isOIDCConfigEnabled({ ...fullConfig, client_id: '' }, 'https://x/auth/callback')).toBe(false);
  });

  it('returns false when client_secret is missing', () => {
    expect(isOIDCConfigEnabled({ ...fullConfig, client_secret: '' }, 'https://x/auth/callback')).toBe(false);
  });
});
