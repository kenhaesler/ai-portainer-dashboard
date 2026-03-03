import { z } from 'zod/v4';

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
  EdgeCheckinInterval: z.number().optional(),
  QueryDate: z.number().optional(),
  Agent: z.object({ Version: z.string().optional() }).optional(),
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
  Labels: z.record(z.string(), z.string()).optional().default({}),
  NetworkSettings: z.object({
    Networks: z.record(z.string(), z.object({
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
  networks: z.record(z.string(), z.object({
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
  Containers: z.record(z.string(), z.object({
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

export const EdgeJobSchema = z.object({
  Id: z.number(),
  Created: z.number(),
  CronExpression: z.string(),
  Name: z.string(),
  ScriptPath: z.string().optional(),
  Recurring: z.boolean(),
  Version: z.number().optional(),
  Endpoints: z.record(z.string(), z.object({
    LogsStatus: z.number().optional(),
    CollectLogs: z.boolean().optional(),
  })).optional(),
}).passthrough();

export const EdgeJobTaskSchema = z.object({
  Id: z.string(),
  EndpointId: z.number(),
  LogsStatus: z.number().optional(),
  CollectLogs: z.boolean().optional(),
}).passthrough();

export const EdgeJobTaskArraySchema = z.array(EdgeJobTaskSchema);

// Pre-compiled array schemas (parsed once at module level for Zod internal caching)
export const EndpointArraySchema = z.array(EndpointSchema);
export const ContainerArraySchema = z.array(ContainerSchema);
export const StackArraySchema = z.array(StackSchema);
export const NetworkArraySchema = z.array(NetworkSchema);
export const ImageArraySchema = z.array(ImageSchema);
export const EdgeJobArraySchema = z.array(EdgeJobSchema);

export type Endpoint = z.infer<typeof EndpointSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type Stack = z.infer<typeof StackSchema>;
export type ContainerStats = z.infer<typeof ContainerStatsSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type DockerImage = z.infer<typeof ImageSchema>;
export type EdgeJob = z.infer<typeof EdgeJobSchema>;
export type EdgeJobTask = z.infer<typeof EdgeJobTaskSchema>;

// ── Kubernetes Resource Schemas ──────────────────────────────────────────────

/** Portainer endpoint type constants */
export const DOCKER_ENDPOINT_TYPES = new Set([1, 2, 4]); // Docker, Agent, Edge Docker
export const KUBERNETES_ENDPOINT_TYPES = new Set([5, 6, 7]); // K8s Local, Agent, Edge

/** Check whether a Portainer endpoint type is Kubernetes. */
export function isKubernetesEndpoint(type: number): boolean {
  return KUBERNETES_ENDPOINT_TYPES.has(type);
}

/** Check whether a Portainer endpoint type is Docker. */
export function isDockerEndpoint(type: number): boolean {
  return DOCKER_ENDPOINT_TYPES.has(type);
}

// Kubernetes Pod (raw K8s API response shape)
export const K8sObjectMetaSchema = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  uid: z.string().optional(),
  creationTimestamp: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional().default({}),
  annotations: z.record(z.string(), z.string()).optional().default({}),
  ownerReferences: z.array(z.object({
    kind: z.string(),
    name: z.string(),
    uid: z.string().optional(),
  })).optional().default([]),
}).passthrough();

export const K8sContainerStatusSchema = z.object({
  name: z.string(),
  ready: z.boolean().optional(),
  restartCount: z.number().optional().default(0),
  state: z.record(z.string(), z.unknown()).optional().default({}),
  image: z.string().optional(),
  imageID: z.string().optional(),
}).passthrough();

export const K8sPodSchema = z.object({
  metadata: K8sObjectMetaSchema,
  spec: z.object({
    nodeName: z.string().optional(),
    containers: z.array(z.object({
      name: z.string(),
      image: z.string().optional(),
      ports: z.array(z.object({
        containerPort: z.number().optional(),
        protocol: z.string().optional(),
        name: z.string().optional(),
      })).optional().default([]),
      resources: z.object({
        requests: z.record(z.string(), z.string()).optional(),
        limits: z.record(z.string(), z.string()).optional(),
      }).optional(),
    })).optional().default([]),
    restartPolicy: z.string().optional(),
  }).passthrough(),
  status: z.object({
    phase: z.string().optional(),
    conditions: z.array(z.object({
      type: z.string(),
      status: z.string(),
    })).optional().default([]),
    containerStatuses: z.array(K8sContainerStatusSchema).optional().default([]),
    startTime: z.string().optional(),
    hostIP: z.string().optional(),
    podIP: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export const K8sDeploymentSchema = z.object({
  metadata: K8sObjectMetaSchema,
  spec: z.object({
    replicas: z.number().optional().default(1),
    selector: z.object({
      matchLabels: z.record(z.string(), z.string()).optional(),
    }).optional(),
    template: z.object({
      spec: z.object({
        containers: z.array(z.object({
          name: z.string(),
          image: z.string().optional(),
        })).optional().default([]),
      }).passthrough().optional(),
    }).passthrough().optional(),
  }).passthrough(),
  status: z.object({
    replicas: z.number().optional().default(0),
    readyReplicas: z.number().optional().default(0),
    availableReplicas: z.number().optional().default(0),
    unavailableReplicas: z.number().optional().default(0),
    updatedReplicas: z.number().optional().default(0),
  }).passthrough().optional(),
}).passthrough();

export const K8sServiceSchema = z.object({
  metadata: K8sObjectMetaSchema,
  spec: z.object({
    type: z.string().optional().default('ClusterIP'),
    clusterIP: z.string().optional(),
    ports: z.array(z.object({
      name: z.string().optional(),
      port: z.number(),
      targetPort: z.union([z.number(), z.string()]).optional(),
      protocol: z.string().optional().default('TCP'),
      nodePort: z.number().optional(),
    })).optional().default([]),
    selector: z.record(z.string(), z.string()).optional(),
    externalIPs: z.array(z.string()).optional().default([]),
    loadBalancerIP: z.string().optional(),
  }).passthrough(),
  status: z.object({
    loadBalancer: z.object({
      ingress: z.array(z.object({
        ip: z.string().optional(),
        hostname: z.string().optional(),
      })).optional().default([]),
    }).optional(),
  }).passthrough().optional(),
}).passthrough();

export const K8sNamespaceSchema = z.object({
  metadata: K8sObjectMetaSchema,
  status: z.object({
    phase: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// K8s list response wrapper
export const K8sListSchema = <T extends z.ZodTypeAny>(itemSchema: T) => z.object({
  kind: z.string().optional(),
  apiVersion: z.string().optional(),
  items: z.array(itemSchema),
}).passthrough();

export const K8sPodListSchema = K8sListSchema(K8sPodSchema);
export const K8sDeploymentListSchema = K8sListSchema(K8sDeploymentSchema);
export const K8sServiceListSchema = K8sListSchema(K8sServiceSchema);
export const K8sNamespaceListSchema = K8sListSchema(K8sNamespaceSchema);

export type K8sPod = z.infer<typeof K8sPodSchema>;
export type K8sDeployment = z.infer<typeof K8sDeploymentSchema>;
export type K8sService = z.infer<typeof K8sServiceSchema>;
export type K8sNamespace = z.infer<typeof K8sNamespaceSchema>;
