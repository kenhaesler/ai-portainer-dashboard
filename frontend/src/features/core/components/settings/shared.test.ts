import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, SETTING_CATEGORY_BY_KEY } from './shared';

describe('DEFAULT_SETTINGS — monitoring.scheduler_interval_minutes', () => {
  const monitoringSettings = DEFAULT_SETTINGS.monitoring;
  const schedulerSetting = monitoringSettings.find(
    (s) => s.key === 'monitoring.scheduler_interval_minutes',
  );

  it('exists in the monitoring category', () => {
    expect(schedulerSetting).toBeDefined();
  });

  it('has type number with min=1 and max=60', () => {
    expect(schedulerSetting!.type).toBe('number');
    expect((schedulerSetting as any).min).toBe(1);
    expect((schedulerSetting as any).max).toBe(60);
  });

  it('defaults to 5 minutes', () => {
    expect(schedulerSetting!.defaultValue).toBe('5');
  });

  it('is mapped to the monitoring category in SETTING_CATEGORY_BY_KEY', () => {
    expect(SETTING_CATEGORY_BY_KEY['monitoring.scheduler_interval_minutes']).toBe('monitoring');
  });

  it('monitoring.enabled still exists', () => {
    const enabledSetting = monitoringSettings.find(
      (s) => s.key === 'monitoring.enabled',
    );
    expect(enabledSetting).toBeDefined();
    expect(enabledSetting!.type).toBe('boolean');
  });
});
