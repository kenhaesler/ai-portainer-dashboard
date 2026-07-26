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
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(normalized).sort());
    expect(parsed.networkIPs).toEqual({ bridge: '172.17.0.2' });
  });

  it('the schema keeps every key inside ports[] too', () => {
    // This schema is used as a Fastify response serializer, so a field the
    // schema does not declare is silently stripped from the payload. That is
    // how the port bind IP went missing and the UI ended up hardcoding
    // "0.0.0.0"; nested drift is now covered, not just top-level.
    const normalized = normalizeContainer(
      {
        Id: 'abc123', Names: ['/web'], Image: 'nginx:latest', State: 'running',
        Status: 'Up 2 hours', Created: 1700000000,
        Ports: [{ IP: '127.0.0.1', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
        Labels: {},
      } as never,
      1,
      'local',
    );
    const parsed = NormalizedContainerSchema.parse(normalized);

    expect(Object.keys(parsed.ports[0]).sort()).toEqual(Object.keys(normalized.ports[0]).sort());
    expect(parsed.ports[0].ip).toBe('127.0.0.1');
  });
});
