import { describe, it, expect } from 'vitest';
import {
  EndpointSchema,
  ContainerSchema,
  StackSchema,
  ContainerStatsSchema,
  NetworkSchema,
  ImageSchema,
} from './portainer.js';

describe('Portainer Models', () => {
  describe('EndpointSchema', () => {
    it('should validate a complete endpoint', () => {
      const endpoint = {
        Id: 1,
        Name: 'local-docker',
        Type: 1,
        URL: 'tcp://localhost:2375',
        Status: 1,
        Snapshots: [{
          DockerSnapshotRaw: {
            Containers: 5,
            ContainersRunning: 3,
            ContainersStopped: 2,
            ContainersPaused: 0,
            Images: 10,
          },
          TotalCPU: 4,
          TotalMemory: 8589934592,
          RunningContainerCount: 3,
          StoppedContainerCount: 2,
          HealthyContainerCount: 2,
          UnhealthyContainerCount: 1,
          StackCount: 2,
          Time: 1640000000,
        }],
        TagIds: [1, 2],
      };

      const result = EndpointSchema.safeParse(endpoint);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Id).toBe(1);
        expect(result.data.Name).toBe('local-docker');
      }
    });

    it('should validate minimal endpoint', () => {
      const endpoint = {
        Id: 1,
        Name: 'test',
        Type: 1,
        URL: 'tcp://localhost:2375',
        Status: 1,
      };

      const result = EndpointSchema.safeParse(endpoint);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Snapshots).toEqual([]);
        expect(result.data.TagIds).toEqual([]);
      }
    });

    it('should validate edge endpoint', () => {
      const endpoint = {
        Id: 2,
        Name: 'edge-agent',
        Type: 4,
        URL: '',
        Status: 1,
        EdgeID: 'edge-123',
        EdgeKey: 'key-456',
        LastCheckInDate: 1640000000,
        Agent: { Version: '2.11.0' },
      };

      const result = EndpointSchema.safeParse(endpoint);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.EdgeID).toBe('edge-123');
        expect(result.data.Agent?.Version).toBe('2.11.0');
      }
    });

    it('should reject missing required fields', () => {
      const endpoint = {
        Name: 'test',
        URL: 'tcp://localhost:2375',
      };

      const result = EndpointSchema.safeParse(endpoint);
      expect(result.success).toBe(false);
    });

    it('should handle null snapshot values', () => {
      const endpoint = {
        Id: 1,
        Name: 'test',
        Type: 1,
        URL: 'tcp://localhost:2375',
        Status: 1,
        Snapshots: [{
          DockerSnapshotRaw: {
            Containers: null,
            ContainersRunning: null,
          },
          TotalCPU: null,
          TotalMemory: null,
        }],
      };

      const result = EndpointSchema.safeParse(endpoint);
      expect(result.success).toBe(true);
    });
  });

  describe('ContainerSchema', () => {
    it('should validate a complete container', () => {
      const container = {
        Id: 'abc123def456789',
        Names: ['/my-container', '/my-container-alias'],
        Image: 'nginx:latest',
        ImageID: 'sha256:abc123',
        Command: 'nginx -g daemon off;',
        Created: 1640000000,
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [
          { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
          { IP: '0.0.0.0', PrivatePort: 443, PublicPort: 8443, Type: 'tcp' },
        ],
        Labels: {
          'com.docker.compose.project': 'myproject',
          'com.docker.compose.service': 'web',
        },
        NetworkSettings: {
          Networks: {
            bridge: {
              NetworkID: 'net123',
              IPAddress: '172.17.0.2',
              Gateway: '172.17.0.1',
            },
          },
        },
        Mounts: [
          { Type: 'bind', Source: '/host/path', Destination: '/container/path', Mode: 'rw', RW: true },
        ],
        HostConfig: {
          NetworkMode: 'bridge',
          Privileged: false,
        },
      };

      const result = ContainerSchema.safeParse(container);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Id).toBe('abc123def456789');
        expect(result.data.Names).toContain('/my-container');
        expect(result.data.State).toBe('running');
      }
    });

    it('should validate minimal container', () => {
      const container = {
        Id: 'abc123',
        Names: ['/test'],
        Image: 'alpine',
        Created: 1640000000,
        State: 'exited',
        Status: 'Exited (0) 5 minutes ago',
      };

      const result = ContainerSchema.safeParse(container);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Ports).toEqual([]);
        expect(result.data.Labels).toEqual({});
        expect(result.data.Mounts).toEqual([]);
      }
    });

    it('should handle null ports', () => {
      const container = {
        Id: 'abc123',
        Names: ['/test'],
        Image: 'alpine',
        Created: 1640000000,
        State: 'running',
        Status: 'Up',
        Ports: null,
      };

      const result = ContainerSchema.safeParse(container);
      expect(result.success).toBe(true);
      if (result.success) {
        // nullish().default([]) only provides default for undefined, null stays null
        expect(result.data.Ports).toBeNull();
      }
    });

    it('should validate different container states', () => {
      const states = ['running', 'exited', 'paused', 'restarting', 'dead', 'created'];

      for (const state of states) {
        const container = {
          Id: 'abc123',
          Names: ['/test'],
          Image: 'alpine',
          Created: 1640000000,
          State: state,
          Status: 'Status',
        };

        const result = ContainerSchema.safeParse(container);
        expect(result.success).toBe(true);
      }
    });

    it('should reject missing required fields', () => {
      const container = {
        Names: ['/test'],
        Image: 'alpine',
      };

      const result = ContainerSchema.safeParse(container);
      expect(result.success).toBe(false);
    });
  });

  describe('StackSchema', () => {
    it('should validate a complete stack', () => {
      const stack = {
        Id: 1,
        Name: 'my-stack',
        Type: 1,
        EndpointId: 1,
        Status: 1,
        CreationDate: 1640000000,
        UpdateDate: 1640100000,
        Env: [
          { name: 'NODE_ENV', value: 'production' },
          { name: 'PORT', value: '3000' },
        ],
      };

      const result = StackSchema.safeParse(stack);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Name).toBe('my-stack');
        expect(result.data.Env).toHaveLength(2);
      }
    });

    it('should validate minimal stack', () => {
      const stack = {
        Id: 1,
        Name: 'minimal-stack',
        Type: 2,
        EndpointId: 1,
        Status: 1,
      };

      const result = StackSchema.safeParse(stack);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Env).toEqual([]);
      }
    });

    it('should handle null env', () => {
      const stack = {
        Id: 1,
        Name: 'stack',
        Type: 1,
        EndpointId: 1,
        Status: 1,
        Env: null,
      };

      const result = StackSchema.safeParse(stack);
      expect(result.success).toBe(true);
      if (result.success) {
        // nullish().default([]) only provides default for undefined, null stays null
        expect(result.data.Env).toBeNull();
      }
    });
  });

  describe('ContainerStatsSchema', () => {
    it('should validate complete stats', () => {
      const stats = {
        cpu_stats: {
          cpu_usage: {
            total_usage: 1000000000,
          },
          system_cpu_usage: 10000000000,
          online_cpus: 4,
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 900000000,
          },
          system_cpu_usage: 9000000000,
        },
        memory_stats: {
          usage: 52428800,
          limit: 1073741824,
          stats: {
            cache: 10485760,
            total_cache: 10485760,
          },
        },
      };

      const result = ContainerStatsSchema.safeParse(stats);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cpu_stats.cpu_usage.total_usage).toBe(1000000000);
        expect(result.data.memory_stats.usage).toBe(52428800);
      }
    });

    it('should handle minimal stats', () => {
      const stats = {
        cpu_stats: {
          cpu_usage: {
            total_usage: 1000,
          },
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 900,
          },
        },
        memory_stats: {},
      };

      const result = ContainerStatsSchema.safeParse(stats);
      expect(result.success).toBe(true);
    });
  });

  describe('NetworkSchema', () => {
    it('should validate a complete network', () => {
      const network = {
        Name: 'my-network',
        Id: 'net123abc456',
        Driver: 'bridge',
        Scope: 'local',
        IPAM: {
          Config: [
            { Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' },
          ],
        },
        Containers: {
          'container1': {
            Name: 'web',
            EndpointID: 'ep1',
            MacAddress: '02:42:ac:12:00:02',
            IPv4Address: '172.18.0.2/16',
          },
        },
      };

      const result = NetworkSchema.safeParse(network);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.Name).toBe('my-network');
        expect(result.data.Driver).toBe('bridge');
      }
    });

    it('should validate minimal network', () => {
      const network = {
        Name: 'test-net',
        Id: 'abc123',
      };

      const result = NetworkSchema.safeParse(network);
      expect(result.success).toBe(true);
    });
  });

  describe('ImageSchema', () => {
    it('should validate a complete image', () => {
      const image = {
        Id: 'sha256:abc123def456',
        RepoTags: ['nginx:latest', 'nginx:1.21'],
        Size: 142000000,
        Created: 1640000000,
      };

      const result = ImageSchema.safeParse(image);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.RepoTags).toContain('nginx:latest');
        expect(result.data.Size).toBe(142000000);
      }
    });

    it('should validate minimal image', () => {
      const image = {
        Id: 'sha256:abc123',
      };

      const result = ImageSchema.safeParse(image);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.RepoTags).toEqual([]);
      }
    });

    it('should handle dangling images (no tags)', () => {
      const image = {
        Id: 'sha256:orphan123',
        RepoTags: [],
        Size: 50000000,
        Created: 1640000000,
      };

      const result = ImageSchema.safeParse(image);
      expect(result.success).toBe(true);
    });
  });
});
