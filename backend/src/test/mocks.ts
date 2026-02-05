/**
 * Test mock factories for backend unit and integration tests
 */

import type { Endpoint, Container, Stack, ContainerStats, Network, DockerImage } from '../models/portainer.js';

// Factory functions for creating test data

export function createMockEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    Id: 1,
    Name: 'test-endpoint',
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
      TotalMemory: 8589934592, // 8 GB
      RunningContainerCount: 3,
      StoppedContainerCount: 2,
      HealthyContainerCount: 2,
      UnhealthyContainerCount: 1,
      StackCount: 2,
      Time: Date.now(),
    }],
    TagIds: [],
    ...overrides,
  };
}

export function createMockContainer(overrides: Partial<Container> = {}): Container {
  return {
    Id: 'abc123def456',
    Names: ['/test-container'],
    Image: 'nginx:latest',
    ImageID: 'sha256:abc123',
    Command: 'nginx -g daemon off;',
    Created: Math.floor(Date.now() / 1000),
    State: 'running',
    Status: 'Up 2 hours',
    Ports: [
      { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    ],
    Labels: {
      'com.docker.compose.project': 'test-project',
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
    Mounts: [],
    HostConfig: {
      NetworkMode: 'bridge',
    },
    ...overrides,
  };
}

export function createMockStack(overrides: Partial<Stack> = {}): Stack {
  return {
    Id: 1,
    Name: 'test-stack',
    Type: 1,
    EndpointId: 1,
    Status: 1,
    CreationDate: Math.floor(Date.now() / 1000),
    UpdateDate: Math.floor(Date.now() / 1000),
    Env: [
      { name: 'NODE_ENV', value: 'production' },
    ],
    ...overrides,
  };
}

export function createMockContainerStats(overrides: Partial<ContainerStats> = {}): ContainerStats {
  return {
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
      usage: 52428800, // 50 MB
      limit: 1073741824, // 1 GB
      stats: {
        cache: 10485760, // 10 MB
      },
    },
    ...overrides,
  };
}

export function createMockNetwork(overrides: Partial<Network> = {}): Network {
  return {
    Name: 'test-network',
    Id: 'net123abc',
    Driver: 'bridge',
    Scope: 'local',
    IPAM: {
      Config: [
        { Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' },
      ],
    },
    Containers: {
      'abc123': {
        Name: 'test-container',
        EndpointID: 'ep123',
        MacAddress: '02:42:ac:12:00:02',
        IPv4Address: '172.18.0.2/16',
      },
    },
    ...overrides,
  };
}

export function createMockImage(overrides: Partial<DockerImage> = {}): DockerImage {
  return {
    Id: 'sha256:abc123def456',
    RepoTags: ['nginx:latest', 'nginx:1.21'],
    Size: 142000000, // ~142 MB
    Created: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// Mock configuration for tests
export function createMockConfig() {
  return {
    PORT: 3001,
    HOST: '0.0.0.0',
    NODE_ENV: 'test' as const,
    PORTAINER_API_URL: 'http://localhost:9000',
    PORTAINER_API_KEY: 'test-api-key',
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
    DASHBOARD_USERNAME: 'admin',
    DASHBOARD_PASSWORD: 'testpassword',
    SQLITE_PATH: ':memory:',
    LOGIN_RATE_LIMIT: 10,
    ANOMALY_ZSCORE_THRESHOLD: 2.5,
    ANOMALY_MOVING_AVERAGE_WINDOW: 10,
    ANOMALY_MIN_SAMPLES: 5,
    METRICS_RETENTION_DAYS: 7,
    BACKUP_RETENTION_DAYS: 30,
    BACKUP_DIR: '/tmp/backups',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.2',
  };
}

// Helper to generate multiple mock items
export function createMockEndpoints(count: number): Endpoint[] {
  return Array.from({ length: count }, (_, i) =>
    createMockEndpoint({ Id: i + 1, Name: `endpoint-${i + 1}` })
  );
}

export function createMockContainers(count: number): Container[] {
  return Array.from({ length: count }, (_, i) =>
    createMockContainer({
      Id: `container-${i + 1}`,
      Names: [`/container-${i + 1}`],
      State: i % 3 === 0 ? 'stopped' : 'running',
    })
  );
}
