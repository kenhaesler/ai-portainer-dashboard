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
import {
  useElkLayout,
  type ElkLayoutNode,
  type ElkLayoutEdge,
} from '@/hooks/use-elk-layout';

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

// --- Handle helpers (pure functions, exported for testing) ---

type HandleDirection = 'top' | 'right' | 'bottom' | 'left';

/** Map an angle (radians, 0 = right, counter-clockwise negative) to the closest handle direction. */
export function getHandleForAngle(angle: number): HandleDirection {
  const TWO_PI = 2 * Math.PI;
  const a = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  if (a < Math.PI / 4 || a >= (7 * Math.PI) / 4) return 'right';
  if (a < (3 * Math.PI) / 4) return 'bottom';
  if (a < (5 * Math.PI) / 4) return 'left';
  return 'top';
}

/** Compute the best source/target handle pair for an edge between two node positions. */
export function getBestHandles(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
): { sourceHandle: HandleDirection; targetHandle: HandleDirection } {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  const angle = Math.atan2(dy, dx);
  const sourceHandle = getHandleForAngle(angle);
  const opposites: Record<HandleDirection, HandleDirection> = {
    top: 'bottom',
    right: 'left',
    bottom: 'top',
    left: 'right',
  };
  return { sourceHandle, targetHandle: opposites[sourceHandle] };
}

// --- End handle helpers ---

const nodeTypes = {
  container: ContainerNode,
  network: NetworkNode,
  'stack-group': StackGroupNode,
};

// Internal grid layout constants
const GROUP_PADDING_X = 20;
const GROUP_PADDING_TOP = 30;
const GROUP_PADDING_BOTTOM = 15;
const CONTAINER_SPACING_X = 160;
const CONTAINER_SPACING_Y = 110;
const CONTAINERS_PER_ROW = 4;
const INLINE_NET_SPACING_X = 140;
const INLINE_NET_ROW_HEIGHT = 90;
const INLINE_NETS_PER_ROW = 4;
const EXTERNAL_NET_WIDTH = 120;
const EXTERNAL_NET_HEIGHT = 80;

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
    return { stroke: '#10b981', strokeWidth: 2 };
  }
  if (totalBytesPerSec < 102_400) {
    return { stroke: '#eab308', strokeWidth: 3 };
  }
  if (totalBytesPerSec < 1_048_576) {
    return { stroke: '#f97316', strokeWidth: 4 };
  }
  return { stroke: '#ef4444', strokeWidth: 6 };
}

/** Data computed per stack before layout — dimensions + children definitions */
interface StackBlueprint {
  stackName: string;
  groupId: string;
  groupWidth: number;
  groupHeight: number;
  /** Children positioned relative to the group (0,0 = group top-left) */
  children: Node[];
  /** Containers in this stack (for edge creation) */
  containers: ContainerData[];
}

export function TopologyGraph({ containers, networks, onNodeClick, networkRates }: TopologyGraphProps) {
  // Phase 1: Compute group dimensions + internal child layouts (no absolute positions yet)
  const { blueprints, externalNets, inlineNetsByStack, netToStacks } = useMemo(() => {
    const stackMap = new Map<string, ContainerData[]>();
    for (const container of containers) {
      const stack = container.labels['com.docker.compose.project'] || 'Standalone';
      if (!stackMap.has(stack)) stackMap.set(stack, []);
      stackMap.get(stack)!.push(container);
    }

    const netToStacks = new Map<string, Set<string>>();
    for (const container of containers) {
      const stack = container.labels['com.docker.compose.project'] || 'Standalone';
      for (const netName of container.networks) {
        if (!netToStacks.has(netName)) netToStacks.set(netName, new Set());
        netToStacks.get(netName)!.add(stack);
      }
    }

    const inlineNetsByStack = new Map<string, NetworkData[]>();
    const externalNets: NetworkData[] = [];
    for (const net of networks) {
      const stacks = netToStacks.get(net.name);
      if (stacks && stacks.size === 1) {
        const stackName = Array.from(stacks)[0];
        if (!inlineNetsByStack.has(stackName)) inlineNetsByStack.set(stackName, []);
        inlineNetsByStack.get(stackName)!.push(net);
      } else {
        externalNets.push(net);
      }
    }

    const stackNames = sortStacks(Array.from(stackMap.keys()), stackMap, networkRates);

    const blueprints: StackBlueprint[] = [];
    for (const stackName of stackNames) {
      const stackContainers = sortContainers(stackMap.get(stackName)!, networkRates);
      const stackContainerIds = stackContainers.map((c) => c.id);
      const stackNets = sortInlineNetworks(inlineNetsByStack.get(stackName) || [], stackContainerIds);

      const netCols = Math.min(stackNets.length, INLINE_NETS_PER_ROW);
      const netRows = stackNets.length > 0 ? Math.ceil(stackNets.length / INLINE_NETS_PER_ROW) : 0;
      const netSectionHeight = netRows * INLINE_NET_ROW_HEIGHT;

      const containerCols = Math.min(stackContainers.length, CONTAINERS_PER_ROW);
      const containerRows = Math.ceil(stackContainers.length / CONTAINERS_PER_ROW);
      const maxCols = Math.max(containerCols, netCols, 1);

      const groupWidth = GROUP_PADDING_X * 2 + maxCols * CONTAINER_SPACING_X;
      const groupHeight =
        GROUP_PADDING_TOP + netSectionHeight + GROUP_PADDING_BOTTOM + containerRows * CONTAINER_SPACING_Y;

      const groupId = `stack-${stackName}`;
      const children: Node[] = [];

      // Inline networks
      stackNets.forEach((net, i) => {
        const row = Math.floor(i / INLINE_NETS_PER_ROW);
        const col = i % INLINE_NETS_PER_ROW;
        children.push({
          id: `net-${net.id}`,
          type: 'network',
          position: {
            x: GROUP_PADDING_X + col * INLINE_NET_SPACING_X,
            y: GROUP_PADDING_TOP + row * INLINE_NET_ROW_HEIGHT,
          },
          parentId: groupId,
          extent: 'parent' as const,
          data: { label: net.name, driver: net.driver, subnet: net.subnet },
        });
      });

      // Containers
      const containerStartY = GROUP_PADDING_TOP + netSectionHeight;
      stackContainers.forEach((container, i) => {
        const row = Math.floor(i / CONTAINERS_PER_ROW);
        const col = i % CONTAINERS_PER_ROW;
        children.push({
          id: `container-${container.id}`,
          type: 'container',
          position: {
            x: GROUP_PADDING_X + col * CONTAINER_SPACING_X,
            y: containerStartY + row * CONTAINER_SPACING_Y,
          },
          parentId: groupId,
          extent: 'parent' as const,
          data: { label: container.name, state: container.state, image: container.image },
        });
      });

      blueprints.push({
        stackName,
        groupId,
        groupWidth,
        groupHeight,
        children,
        containers: stackContainers,
      });
    }

    return { blueprints, externalNets, inlineNetsByStack, netToStacks };
  }, [containers, networks, networkRates]);

  // Phase 2: Build elk-layout input — group nodes + external net nodes + edges
  const { elkNodes, elkEdges } = useMemo(() => {
    const elkNodes: ElkLayoutNode[] = [];
    const elkEdges: ElkLayoutEdge[] = [];
    const edgeSet = new Set<string>();

    // Groups as elk nodes (use actual dimensions)
    for (const bp of blueprints) {
      elkNodes.push({ id: bp.groupId, width: bp.groupWidth, height: bp.groupHeight });
    }

    // External networks as elk nodes
    for (const net of externalNets) {
      elkNodes.push({ id: `net-${net.id}`, width: EXTERNAL_NET_WIDTH, height: EXTERNAL_NET_HEIGHT });
    }

    // Edges: external net ↔ groups that use it
    for (const net of externalNets) {
      const netNodeId = `net-${net.id}`;
      const stacks = netToStacks.get(net.name);
      if (!stacks) continue;
      for (const stackName of stacks) {
        const groupId = `stack-${stackName}`;
        const key = `${netNodeId}--${groupId}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          elkEdges.push({ id: key, source: netNodeId, target: groupId });
        }
      }
    }

    return { elkNodes, elkEdges };
  }, [blueprints, externalNets, netToStacks]);

  // Phase 3: Run elkjs layout to get group positions (deterministic)
  const groupPositions = useElkLayout({ nodes: elkNodes, edges: elkEdges });

  // Phase 4: Assemble final React Flow nodes and edges using force-computed positions
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeAbsolutePositions = new Map<string, { x: number; y: number }>();

    for (const bp of blueprints) {
      const pos = groupPositions.get(bp.groupId) ?? { x: 0, y: 0 };

      // Group node
      nodes.push({
        id: bp.groupId,
        type: 'stack-group',
        position: { x: pos.x, y: pos.y },
        data: { label: bp.stackName },
        style: { width: bp.groupWidth, height: bp.groupHeight },
      });

      // Children (relative to group)
      for (const child of bp.children) {
        nodes.push(child);
        // Track absolute position for edge handle computation
        nodeAbsolutePositions.set(child.id, {
          x: pos.x + child.position.x,
          y: pos.y + child.position.y,
        });
      }

      // Edges from containers to networks
      for (const container of bp.containers) {
        container.networks.forEach((netName) => {
          const net = networks.find((n) => n.name === netName);
          if (net) {
            const sourceId = `container-${container.id}`;
            const targetId = `net-${net.id}`;
            const sourcePos = nodeAbsolutePositions.get(sourceId);
            const targetPos = nodeAbsolutePositions.get(targetId);
            const handles = sourcePos && targetPos
              ? getBestHandles(sourcePos, targetPos)
              : { sourceHandle: 'top' as HandleDirection, targetHandle: 'bottom' as HandleDirection };

            const edgeStyle = getEdgeStyle(container.id, container.state, networkRates);
            edges.push({
              id: `e-${container.id}-${net.id}`,
              source: sourceId,
              target: targetId,
              sourceHandle: handles.sourceHandle,
              targetHandle: handles.targetHandle,
              type: 'smoothstep',
              animated: container.state === 'running',
              style: {
                stroke: edgeStyle.stroke,
                strokeWidth: edgeStyle.strokeWidth,
                opacity: 0.7,
              },
            });
          }
        });
      }
    }

    // External network nodes
    for (const net of externalNets) {
      const netNodeId = `net-${net.id}`;
      const pos = groupPositions.get(netNodeId) ?? { x: 0, y: 0 };
      nodes.push({
        id: netNodeId,
        type: 'network',
        position: { x: pos.x, y: pos.y },
        data: { label: net.name, driver: net.driver, subnet: net.subnet },
      });
      nodeAbsolutePositions.set(netNodeId, pos);
    }

    // Edges from containers to external networks (may not have been created above
    // because the external net wasn't positioned yet when inline edges were made)
    for (const container of containers) {
      for (const netName of container.networks) {
        const net = externalNets.find((n) => n.name === netName);
        if (net) {
          const sourceId = `container-${container.id}`;
          const targetId = `net-${net.id}`;
          const edgeId = `e-${container.id}-${net.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            const sourcePos = nodeAbsolutePositions.get(sourceId);
            const targetPos = nodeAbsolutePositions.get(targetId);
            const handles = sourcePos && targetPos
              ? getBestHandles(sourcePos, targetPos)
              : { sourceHandle: 'left' as HandleDirection, targetHandle: 'right' as HandleDirection };

            const edgeStyle = getEdgeStyle(container.id, container.state, networkRates);
            edges.push({
              id: edgeId,
              source: sourceId,
              target: targetId,
              sourceHandle: handles.sourceHandle,
              targetHandle: handles.targetHandle,
              type: 'smoothstep',
              animated: container.state === 'running',
              style: {
                stroke: edgeStyle.stroke,
                strokeWidth: edgeStyle.strokeWidth,
                opacity: 0.7,
              },
            });
          }
        }
      }
    }

    return { nodes, edges };
  }, [blueprints, externalNets, groupPositions, containers, networks, networkRates]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
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
