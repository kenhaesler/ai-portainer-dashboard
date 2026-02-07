import { z } from 'zod';

export const EndpointSchema = z.object({
  Id: z.number(),
  Name: z.string(),
  Type: z.number(),
  URL: z.string(),
  Status: z.number(),
  Snapshots: z.array(z.object({
    DockerSnapshotRaw: z.object({
      Containers: z.number().nullish(),
      ContainersRunning: z.number().nullish(),
      ContainersStopped: z.number().nullish(),
      ContainersPaused: z.number().nullish(),
      Images: z.number().nullish(),
    }).passthrough().nullish(),
    TotalCPU: z.number().nullish(),
    TotalMemory: z.number().nullish(),
    RunningContainerCount: z.number().nullish(),
    StoppedContainerCount: z.number().nullish(),
    HealthyContainerCount: z.number().nullish(),
    UnhealthyContainerCount: z.number().nullish(),
    StackCount: z.number().nullish(),
    Time: z.number().nullish(),
  })).optional().default([]),
  TagIds: z.array(z.number()).optional().default([]),
  EdgeID: z.string().optional(),
  EdgeKey: z.string().optional(),
  LastCheckInDate: z.number().optional(),
  Agent: z.object({ Version: z.string() }).optional(),
}).passthrough();

export const ContainerSchema = z.object({
  Id: z.string(),
  Names: z.array(z.string()),
  Image: z.string(),
  ImageID: z.string().optional(),
  Command: z.string().optional(),
  Created: z.number(),
  State: z.string(),
  Status: z.string(),
  Ports: z.array(z.object({
    IP: z.string().optional(),
    PrivatePort: z.number().optional(),
    PublicPort: z.number().optional(),
    Type: z.string().optional(),
  })).nullish().default([]),
  Labels: z.record(z.string()).optional().default({}),
  NetworkSettings: z.object({
    Networks: z.record(z.object({
      NetworkID: z.string().optional(),
      IPAddress: z.string().optional(),
      Gateway: z.string().optional(),
    })).optional(),
  }).optional(),
  Mounts: z.array(z.object({
    Type: z.string().optional(),
    Name: z.string().optional(),
    Source: z.string().optional(),
    Destination: z.string().optional(),
    Mode: z.string().optional(),
    RW: z.boolean().optional(),
  })).optional().default([]),
  HostConfig: z.object({
    NetworkMode: z.string().optional(),
    Privileged: z.boolean().optional(),
    CapAdd: z.array(z.string()).optional(),
    PidMode: z.string().optional(),
  }).optional(),
}).passthrough();

export const StackSchema = z.object({
  Id: z.number(),
  Name: z.string(),
  Type: z.number(),
  EndpointId: z.number(),
  Status: z.number(),
  CreationDate: z.number().optional(),
  UpdateDate: z.number().optional(),
  Env: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).nullish().default([]),
}).passthrough();

export const ContainerStatsSchema = z.object({
  cpu_stats: z.object({
    cpu_usage: z.object({
      total_usage: z.number(),
    }),
    system_cpu_usage: z.number().optional(),
    online_cpus: z.number().optional(),
  }),
  precpu_stats: z.object({
    cpu_usage: z.object({
      total_usage: z.number(),
    }),
    system_cpu_usage: z.number().optional(),
  }),
  memory_stats: z.object({
    usage: z.number().optional(),
    limit: z.number().optional(),
    stats: z.object({
      cache: z.number().optional(),
      total_cache: z.number().optional(),
    }).optional(),
  }),
  networks: z.record(z.object({
    rx_bytes: z.number().optional().default(0),
    tx_bytes: z.number().optional().default(0),
  })).optional(),
}).passthrough();

export const NetworkSchema = z.object({
  Name: z.string(),
  Id: z.string(),
  Driver: z.string().optional(),
  Scope: z.string().optional(),
  IPAM: z.object({
    Config: z.array(z.object({
      Subnet: z.string().optional(),
      Gateway: z.string().optional(),
    })).nullable().optional(),
  }).optional(),
  Containers: z.record(z.object({
    Name: z.string().optional(),
    EndpointID: z.string().optional(),
    MacAddress: z.string().optional(),
    IPv4Address: z.string().optional(),
  })).optional(),
}).passthrough();

export const ImageSchema = z.object({
  Id: z.string(),
  RepoTags: z.array(z.string()).optional().default([]),
  Size: z.number().optional(),
  Created: z.number().optional(),
}).passthrough();

// Pre-compiled array schemas (parsed once at module level for Zod internal caching)
export const EndpointArraySchema = z.array(EndpointSchema);
export const ContainerArraySchema = z.array(ContainerSchema);
export const StackArraySchema = z.array(StackSchema);
export const NetworkArraySchema = z.array(NetworkSchema);
export const ImageArraySchema = z.array(ImageSchema);

export type Endpoint = z.infer<typeof EndpointSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type Stack = z.infer<typeof StackSchema>;
export type ContainerStats = z.infer<typeof ContainerStatsSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type DockerImage = z.infer<typeof ImageSchema>;
