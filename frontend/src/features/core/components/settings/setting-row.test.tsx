import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  GUARDED_SETTING_KEYS,
  SETTING_BY_KEY,
  SettingRow,
  SettingsSavedKeysProvider,
  isGuardedSetting,
  searchSettings,
  settingConsequence,
  settingDomId,
  settingRisk,
  shrinksRetentionWindow,
} from './shared';

function rowFor(key: string, overrides: Partial<Parameters<typeof SettingRow>[0]> = {}) {
  return (
    <SettingRow
      setting={SETTING_BY_KEY[key]}
      value={SETTING_BY_KEY[key].defaultValue}
      onChange={vi.fn()}
      hasChanges={false}
      {...overrides}
    />
  );
}

describe('setting risk descriptors', () => {
  it('marks the OIDC plaintext toggle as security-risk with a consequence', () => {
    const setting = SETTING_BY_KEY['oidc.allow_insecure_transport'];
    expect(settingRisk(setting)).toBe('security');
    expect(settingConsequence(setting)).toMatch(/unencrypted/i);
  });

  it('marks the public status page as security-risk', () => {
    expect(settingRisk(SETTING_BY_KEY['status.page.enabled'])).toBe('security');
    expect(settingConsequence(SETTING_BY_KEY['status.page.enabled'])).toMatch(/no sign-in/i);
  });

  it('marks every retention window as destructive with a consequence', () => {
    for (const setting of DEFAULT_SETTINGS.metricsRetention) {
      expect(settingRisk(setting)).toBe('destructive');
      expect(settingConsequence(setting)).toMatch(/deletes/i);
    }
    expect(settingRisk(SETTING_BY_KEY['portainer_backup.max_count'])).toBe('destructive');
    expect(settingRisk(SETTING_BY_KEY['monitoring.metric_retention_days'])).toBe('destructive');
  });

  it('leaves ordinary knobs unmarked so the marking still means something', () => {
    expect(settingRisk(SETTING_BY_KEY['cache.image_ttl'])).toBeUndefined();
    expect(settingRisk(SETTING_BY_KEY['monitoring.polling_interval'])).toBeUndefined();
    expect(settingRisk(SETTING_BY_KEY['status.page.title'])).toBeUndefined();
    // The guarded set must stay a minority of the ~107 keys.
    expect(GUARDED_SETTING_KEYS.size).toBeLessThan(Object.keys(SETTING_BY_KEY).length / 2);
  });

  it('guards every authentication key', () => {
    for (const setting of DEFAULT_SETTINGS.authentication) {
      expect(isGuardedSetting(setting.key)).toBe(true);
    }
  });

  it('does not weaken any default value', () => {
    expect(SETTING_BY_KEY['oidc.allow_insecure_transport'].defaultValue).toBe('false');
    expect(SETTING_BY_KEY['status.page.enabled'].defaultValue).toBe('false');
    expect(SETTING_BY_KEY['oidc.allow_unmapped_viewer'].defaultValue).toBe('false');
    expect(SETTING_BY_KEY['harbor.verify_ssl'].defaultValue).toBe('true');
    expect(SETTING_BY_KEY['elasticsearch.verify_ssl'].defaultValue).toBe('true');
  });
});

describe('shrinksRetentionWindow', () => {
  it('is true only when a destructive window is lowered', () => {
    expect(shrinksRetentionWindow('infrastructure.metrics_raw_retention_days', '3', '30')).toBe(true);
    expect(shrinksRetentionWindow('infrastructure.metrics_raw_retention_days', '60', '30')).toBe(false);
    expect(shrinksRetentionWindow('infrastructure.metrics_raw_retention_days', '30', '30')).toBe(false);
  });

  it('ignores non-destructive keys and unparseable values', () => {
    expect(shrinksRetentionWindow('cache.image_ttl', '30', '600')).toBe(false);
    expect(shrinksRetentionWindow('infrastructure.metrics_raw_retention_days', '', '30')).toBe(false);
  });
});

describe('SettingRow', () => {
  it('gives a security setting its own chrome and states the consequence', () => {
    render(rowFor('oidc.allow_insecure_transport'));

    const row = screen.getByTestId('setting-row-oidc.allow_insecure_transport');
    expect(row).toHaveAttribute('data-risk', 'security');
    expect(within(row).getByText('Security')).toBeInTheDocument();
    expect(row).toHaveTextContent(/Anyone on the network path can capture and replay them/i);
  });

  it('gives a retention setting the destructive marker', () => {
    render(rowFor('infrastructure.metrics_raw_retention_days'));

    const row = screen.getByTestId('setting-row-infrastructure.metrics_raw_retention_days');
    expect(row).toHaveAttribute('data-risk', 'destructive');
    expect(within(row).getByText('Deletes data')).toBeInTheDocument();
  });

  it('leaves an ordinary setting unmarked', () => {
    render(rowFor('cache.image_ttl'));

    const row = screen.getByTestId('setting-row-cache.image_ttl');
    expect(row).not.toHaveAttribute('data-risk');
    expect(within(row).queryByText('Security')).not.toBeInTheDocument();
    expect(within(row).queryByText('Deletes data')).not.toBeInTheDocument();
  });

  it('labels its number input so it is reachable by name', () => {
    render(rowFor('cache.image_ttl'));

    const input = screen.getByLabelText('Image Cache TTL');
    expect(input).toHaveAttribute('id', settingDomId('cache.image_ttl'));
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAccessibleDescription(/Time to cache image list/i);
  });

  it('exposes a boolean setting as a named switch', () => {
    const onChange = vi.fn();
    render(rowFor('status.page.enabled', { onChange }));

    const toggle = screen.getByRole('switch', { name: 'Enable Status Page' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('true');
  });

  it('gives the password reveal button an accessible name', () => {
    render(rowFor('oidc.client_secret'));

    expect(screen.getByRole('button', { name: 'Show Client Secret' })).toBeInTheDocument();
  });

  it('confirms at the row when the key has just been saved', () => {
    render(
      <SettingsSavedKeysProvider savedKeys={new Set(['cache.image_ttl'])}>
        {rowFor('cache.image_ttl')}
      </SettingsSavedKeysProvider>,
    );

    expect(screen.getByTestId('setting-saved-cache.image_ttl')).toHaveTextContent('Saved');
  });

  it('says "Unsaved" rather than "Modified" on a guarded key, because nothing will commit on its own', () => {
    render(rowFor('oidc.client_id', { value: 'changed', hasChanges: true }));

    const row = screen.getByTestId('setting-row-oidc.client_id');
    expect(within(row).getByText('Unsaved')).toBeInTheDocument();
    expect(within(row).queryByText('Modified')).not.toBeInTheDocument();
  });
});

describe('searchSettings', () => {
  it('finds a key by a word from its label and ranks label matches first', () => {
    const results = searchSettings('retention');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].label).toMatch(/retention/i);
    expect(results.map((r) => r.key)).toContain('infrastructure.metrics_raw_retention_days');
  });

  it('finds a key by its dotted key and by its description', () => {
    expect(searchSettings('oidc.client_secret').map((r) => r.key)).toContain('oidc.client_secret');
    expect(searchSettings('BotFather').map((r) => r.key)).toContain('notifications.telegram_bot_token');
  });

  it('reports the category so the caller can route to the right tab', () => {
    const match = searchSettings('polling interval')[0];
    expect(match.key).toBe('monitoring.polling_interval');
    expect(match.category).toBe('monitoring');
  });

  it('carries the risk class through, and stays quiet below two characters', () => {
    expect(searchSettings('status page')[0].risk).toBeDefined();
    expect(searchSettings('a')).toEqual([]);
    expect(searchSettings('  ')).toEqual([]);
  });
});
