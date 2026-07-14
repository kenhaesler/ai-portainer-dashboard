import { describe, it, expect } from 'vitest';
import { NormalizedContainerSchema } from '@dashboard/contracts';
import { normalizeContainer } from './portainer-normalizers.js';

describe('NormalizedContainerSchema ⇄ normalizeContainer drift guard', () => {
  it('the schema keeps every key the live normalizer produces', () => {
    const normalized = normalizeContainer(
      {
        Id: 'abc123', Names: ['/web'], Image: 'nginx:latest', State: 'running',
        Status: 'Up 2 hours (healthy)', Created: 1700000000,
        Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
        Labels: { app: 'web' },
        NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.2' } } },
      } as never,
      1,
      'local',
    );
    const parsed = NormalizedContainerSchema.parse(normalized);
    // If the schema omits a field the normalizer emits, parse() strips it and
    // the key sets diverge — catching the exact class of drift as networkIPs.
    // Scope: top-level keys only. Drift nested inside `ports[]`/`ContainerPortSchema`
    // is NOT covered here (those fields are all-optional today, so nothing to strip);
    // extend this if the port shape ever gains required fields.
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(normalized).sort());
    expect(parsed.networkIPs).toEqual({ bridge: '172.17.0.2' });
  });
});
