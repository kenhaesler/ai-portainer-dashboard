import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ContainerNode } from './container-node';
import { NetworkNode } from './network-node';
import { StackGroupNode } from './stack-group-node';

export interface ContainerData {
  id: string;
  name: string;
  state: 'running' | 'stopped' | 'paused' | 'unknown';
  image: string;
  networks: string[];
  labels: Record<string, string>;
}

export interface NetworkData {
  id: string;
  name: string;
  driver?: string;
  subnet?: string;
  containers: string[];
}

export interface NetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

interface TopologyGraphProps {
  containers: ContainerData[];
  networks: NetworkData[];
  onNodeClick?: (nodeId: string) => void;
  networkRates?: Record<string, NetworkRate>;
}

// --- Sorting helpers (pure functions, exported for testing) ---

/** Map container state to sort priority (lower = higher priority). */
export function getStatePriority(state: string): number {
  switch (state) {
    case 'running': return 0;
    case 'paused': return 1;
    case 'stopped': return 2;
    default: return 3; // unknown or unrecognised
  }
}

/** Sum rx+tx bytes/sec for a container, or 0 if absent. */
export function getContainerTraffic(
  containerId: string,
  networkRates?: Record<string, NetworkRate>,
): number {
  const rate = networkRates?.[containerId];
  if (!rate) return 0;
  return rate.rxBytesPerSec + rate.txBytesPerSec;
}

/** Sort containers: state priority asc → traffic desc → name asc. */
export function sortContainers(
  containers: ContainerData[],
  networkRates?: Record<string, NetworkRate>,
): ContainerData[] {
  return [...containers].sort((a, b) => {
    const stateDiff = getStatePriority(a.state) - getStatePriority(b.state);
    if (stateDiff !== 0) return stateDiff;
    const trafficDiff = getContainerTraffic(b.id, networkRates) - getContainerTraffic(a.id, networkRates);
    if (trafficDiff !== 0) return trafficDiff;
    return a.name.localeCompare(b.name);
  });
}

/** Sort inline networks: connected container count desc → name asc. */
export function sortInlineNetworks(
  networks: NetworkData[],
  stackContainerIds: string[],
): NetworkData[] {
  const idSet = new Set(stackContainerIds);
  return [...networks].sort((a, b) => {
    const aCount = a.containers.filter(id => idSet.has(id)).length;
    const bCount = b.containers.filter(id => idSet.has(id)).length;
    if (bCount !== aCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  });
}

/** Compute median Y of connected containers for a network (for edge crossing minimisation). */
export function computeNetworkMedianY(
  network: NetworkData,
  containerPositions: Map<string, number>,
): number {
  const ys = network.containers
    .map(id => containerPositions.get(id))
    .filter((y): y is number => y !== undefined);
  if (ys.length === 0) return 0;
  ys.sort((a, b) => a - b);
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 !== 0 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
}

/** Returns true if any container is stopped or paused. */
export function hasUnhealthyContainers(containers: ContainerData[]): boolean {
  return containers.some(c => c.state === 'stopped' || c.state === 'paused');
}

/** Sum traffic of all containers in a stack. */
export function getStackTraffic(
  containers: ContainerData[],
  networkRates?: Record<string, NetworkRate>,
): number {
  return containers.reduce((sum, c) => sum + getContainerTraffic(c.id, networkRates), 0);
}

/** Sort stack names: unhealthy first → traffic desc → container count desc → name asc; "Standalone" always last. */
export function sortStacks(
  stackNames: string[],
  stackMap: Map<string, ContainerData[]>,
  networkRates?: Record<string, NetworkRate>,
): string[] {
  return [...stackNames].sort((a, b) => {
    if (a === 'Standalone') return 1;
    if (b === 'Standalone') return -1;
    const aUnhealthy = hasUnhealthyContainers(stackMap.get(a) || []);
    const bUnhealthy = hasUnhealthyContainers(stackMap.get(b) || []);
    if (aUnhealthy !== bUnhealthy) return aUnhealthy ? -1 : 1;
    const trafficDiff = getStackTraffic(stackMap.get(b) || [], networkRates) - getStackTraffic(stackMap.get(a) || [], networkRates);
    if (trafficDiff !== 0) return trafficDiff;
    const countDiff = (stackMap.get(b)?.length || 0) - (stackMap.get(a)?.length || 0);
    if (countDiff !== 0) return countDiff;
    return a.localeCompare(b);
  });
}

// --- End sorting helpers ---

const nodeTypes = {
  container: ContainerNode,
  network: NetworkNode,
  'stack-group': StackGroupNode,
};

// Layout constants
const NETWORK_X = 0;
const NETWORK_SPACING_Y = 120;
const NETWORK_START_Y = 50;

const GROUP_START_X = 300;
const GROUP_START_Y = 50;
const GROUP_SPACING_Y = 40;
const GROUP_PADDING_X = 20;
const GROUP_PADDING_TOP = 30;
const GROUP_PADDING_BOTTOM = 15;

export function getEdgeStyle(
  containerId: string,
  state: string,
  networkRates?: Record<string, NetworkRate>,
): { stroke: string; strokeWidth: number } {
  if (state !== 'running') {
    return { stroke: '#6b7280', strokeWidth: 1.5 };
  }

  const rate = networkRates?.[containerId];
  if (!rate) {
    return { stroke: '#6b7280', strokeWidth: 1.5 };
  }

  const totalBytesPerSec = rate.rxBytesPerSec + rate.txBytesPerSec;

  if (totalBytesPerSec === 0) {
    return { stroke: '#6b7280', strokeWidth: 1.5 };
  }
  if (totalBytesPerSec < 10_240) {
    // < 10 KB/s
    return { stroke: '#10b981', strokeWidth: 2 };
  }
  if (totalBytesPerSec < 102_400) {
    // < 100 KB/s
    return { stroke: '#eab308', strokeWidth: 3 };
  }
  if (totalBytesPerSec < 1_048_576) {
    // < 1 MB/s
    return { stroke: '#f97316', strokeWidth: 4 };
  }
  // >= 1 MB/s
  return { stroke: '#ef4444', strokeWidth: 6 };
}

const CONTAINER_WIDTH = 140;
const CONTAINER_HEIGHT = 90;
const CONTAINER_SPACING_X = 160;
const CONTAINER_SPACING_Y = 110;
const CONTAINERS_PER_ROW = 4;

const INLINE_NET_SPACING_X = 140;
const INLINE_NET_ROW_HEIGHT = 90;
const INLINE_NETS_PER_ROW = 4;

export function TopologyGraph({ containers, networks, onNodeClick, networkRates }: TopologyGraphProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Group containers by stack/project
    const stackMap = new Map<string, ContainerData[]>();
    for (const container of containers) {
      const stack = container.labels['com.docker.compose.project'] || 'Standalone';
      if (!stackMap.has(stack)) {
        stackMap.set(stack, []);
      }
      stackMap.get(stack)!.push(container);
    }

    // Classify networks: single-stack (inline) vs cross-stack (external bridge)
    const netToStacks = new Map<string, Set<string>>();
    for (const container of containers) {
      const stack = container.labels['com.docker.compose.project'] || 'Standalone';
      for (const netName of container.networks) {
        if (!netToStacks.has(netName)) {
          netToStacks.set(netName, new Set());
        }
        netToStacks.get(netName)!.add(stack);
      }
    }

    const inlineNetsByStack = new Map<string, NetworkData[]>();
    const externalNets: NetworkData[] = [];

    for (const net of networks) {
      const stacks = netToStacks.get(net.name);
      if (stacks && stacks.size === 1) {
        // Network belongs to a single stack — place inside the group
        const stackName = Array.from(stacks)[0];
        if (!inlineNetsByStack.has(stackName)) {
          inlineNetsByStack.set(stackName, []);
        }
        inlineNetsByStack.get(stackName)!.push(net);
      } else {
        // Cross-stack, system, or unused network — keep external
        externalNets.push(net);
      }
    }

    // Sort stacks: unhealthy first → traffic desc → count desc → name asc; Standalone last
    const stackNames = sortStacks(Array.from(stackMap.keys()), stackMap, networkRates);

    // Create stack group nodes with inline networks + containers
    let groupY = GROUP_START_Y;

    // Track absolute container Y positions for external network median heuristic
    const containerAbsoluteY = new Map<string, number>();

    for (const stackName of stackNames) {
      const stackContainers = sortContainers(stackMap.get(stackName)!, networkRates);
      const stackContainerIds = stackContainers.map(c => c.id);
      const stackNets = sortInlineNetworks(inlineNetsByStack.get(stackName) || [], stackContainerIds);

      // Inline network rows at the top of the group
      const netCols = Math.min(stackNets.length, INLINE_NETS_PER_ROW);
      const netRows = stackNets.length > 0 ? Math.ceil(stackNets.length / INLINE_NETS_PER_ROW) : 0;
      const netSectionHeight = netRows * INLINE_NET_ROW_HEIGHT;

      // Container rows below the networks
      const containerCols = Math.min(stackContainers.length, CONTAINERS_PER_ROW);
      const containerRows = Math.ceil(stackContainers.length / CONTAINERS_PER_ROW);

      const maxCols = Math.max(containerCols, netCols);
      const groupWidth = GROUP_PADDING_X * 2 + maxCols * CONTAINER_SPACING_X;
      const groupHeight = GROUP_PADDING_TOP + netSectionHeight + GROUP_PADDING_BOTTOM + containerRows * CONTAINER_SPACING_Y;

      const groupId = `stack-${stackName}`;

      // Group node
      nodes.push({
        id: groupId,
        type: 'stack-group',
        position: { x: GROUP_START_X, y: groupY },
        data: { label: stackName },
        style: { width: groupWidth, height: groupHeight },
      });

      // Inline network nodes inside the group (top section)
      stackNets.forEach((net, i) => {
        const row = Math.floor(i / INLINE_NETS_PER_ROW);
        const col = i % INLINE_NETS_PER_ROW;

        nodes.push({
          id: `net-${net.id}`,
          type: 'network',
          position: {
            x: GROUP_PADDING_X + col * INLINE_NET_SPACING_X,
            y: GROUP_PADDING_TOP + row * INLINE_NET_ROW_HEIGHT,
          },
          parentId: groupId,
          extent: 'parent' as const,
          data: {
            label: net.name,
            driver: net.driver,
            subnet: net.subnet,
          },
        });
      });

      // Container nodes inside the group (below networks)
      const containerStartY = GROUP_PADDING_TOP + netSectionHeight;
      stackContainers.forEach((container, i) => {
        const row = Math.floor(i / CONTAINERS_PER_ROW);
        const col = i % CONTAINERS_PER_ROW;

        const containerRelY = containerStartY + row * CONTAINER_SPACING_Y;
        nodes.push({
          id: `container-${container.id}`,
          type: 'container',
          position: {
            x: GROUP_PADDING_X + col * CONTAINER_SPACING_X,
            y: containerRelY,
          },
          parentId: groupId,
          extent: 'parent' as const,
          data: {
            label: container.name,
            state: container.state,
            image: container.image,
          },
        });

        // Record absolute Y for external network median heuristic
        containerAbsoluteY.set(container.id, groupY + containerRelY);

        // Edges from container to networks
        container.networks.forEach((netName) => {
          const net = networks.find((n) => n.name === netName);
          if (net) {
            const edgeStyle = getEdgeStyle(container.id, container.state, networkRates);
            edges.push({
              id: `e-${container.id}-${net.id}`,
              source: `container-${container.id}`,
              target: `net-${net.id}`,
              animated: container.state === 'running',
              style: {
                stroke: edgeStyle.stroke,
                strokeWidth: edgeStyle.strokeWidth,
                opacity: 0.7,
              },
            });
          }
        });
      });

      groupY += groupHeight + GROUP_SPACING_Y;
    }

    // External (cross-stack / bridge) network nodes on the left — median Y heuristic
    // Sort by median Y of connected containers to minimise edge crossings
    const externalNetsSorted = externalNets
      .map(net => ({ net, medianY: computeNetworkMedianY(net, containerAbsoluteY) }))
      .sort((a, b) => a.medianY - b.medianY);

    // Place with minimum spacing, anchored around the median positions
    const totalGroupsHeight = groupY - GROUP_SPACING_Y - GROUP_START_Y;
    const networksTotalHeight = externalNetsSorted.length * NETWORK_SPACING_Y;
    const networkStartY = NETWORK_START_Y + Math.max(0, (totalGroupsHeight - networksTotalHeight) / 2);

    externalNetsSorted.forEach(({ net }, i) => {
      nodes.push({
        id: `net-${net.id}`,
        type: 'network',
        position: { x: NETWORK_X, y: networkStartY + i * NETWORK_SPACING_Y },
        data: {
          label: net.name,
          driver: net.driver,
          subnet: net.subnet,
        },
      });
    });

    return { nodes, edges };
  }, [containers, networks, networkRates]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes/edges when data changes (networkRates, containers, networks)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (onNodeClick) {
      onNodeClick(node.id);
    }
  }, [onNodeClick]);

  if (!containers.length && !networks.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No topology data. Select an endpoint to view its network topology.
      </div>
    );
  }

  return (
    <div className="h-full rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
