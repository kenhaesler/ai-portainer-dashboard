import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getInfrastructureServicePatterns,
  isInfrastructureService,
} from './infrastructure-service-classifier.js';

const mockGetSetting = vi.hoisted(() => vi.fn());

vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

describe('infrastructure-service-classifier', () => {
  beforeEach(() => {
    mockGetSetting.mockReset();
  });

  it('falls back to default infrastructure patterns when setting is not present', () => {
    mockGetSetting.mockReturnValue(undefined);
    expect(getInfrastructureServicePatterns()).toEqual(['traefik', 'portainer_agent', 'beyla']);
  });

  it('loads patterns from JSON array setting', () => {
    mockGetSetting.mockReturnValue({
      value: '["Traefik","portainer_agent","beyla","Traefik"]',
    });
    expect(getInfrastructureServicePatterns()).toEqual(['traefik', 'portainer_agent', 'beyla']);
  });

  it('loads patterns from comma-separated setting', () => {
    mockGetSetting.mockReturnValue({
      value: 'traefik,portainer_agent,beyla',
    });
    expect(getInfrastructureServicePatterns()).toEqual(['traefik', 'portainer_agent', 'beyla']);
  });

  it('matches exact and prefixed infrastructure service names', () => {
    const patterns = ['traefik', 'portainer_agent', 'beyla'];
    expect(isInfrastructureService('traefik', patterns)).toBe(true);
    expect(isInfrastructureService('traefik-prod', patterns)).toBe(true);
    expect(isInfrastructureService('portainer_agent_1', patterns)).toBe(true);
    expect(isInfrastructureService('customer-api', patterns)).toBe(false);
  });
});

