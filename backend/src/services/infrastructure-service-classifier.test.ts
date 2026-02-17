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

  it('falls back to default infrastructure patterns when setting is not present', async () => {
    mockGetSetting.mockResolvedValue(undefined);
    expect(await getInfrastructureServicePatterns()).toEqual(['traefik', 'portainer_agent', 'beyla']);
  });

  it('loads patterns from JSON array setting', async () => {
    mockGetSetting.mockResolvedValue({
      value: '["Traefik","portainer_agent","beyla","Traefik"]',
    });
    expect(await getInfrastructureServicePatterns()).toEqual(['traefik', 'portainer_agent', 'beyla']);
  });

  it('loads patterns from comma-separated setting', async () => {
    mockGetSetting.mockResolvedValue({
      value: 'traefik,portainer_agent,beyla',
    });
    expect(await getInfrastructureServicePatterns()).toEqual(['traefik', 'portainer_agent', 'beyla']);
  });

  it('matches exact and prefixed infrastructure service names', async () => {
    const patterns = ['traefik', 'portainer_agent', 'beyla'];
    expect(await isInfrastructureService('traefik', patterns)).toBe(true);
    expect(await isInfrastructureService('traefik-prod', patterns)).toBe(true);
    expect(await isInfrastructureService('portainer_agent_1', patterns)).toBe(true);
    expect(await isInfrastructureService('customer-api', patterns)).toBe(false);
  });
});
