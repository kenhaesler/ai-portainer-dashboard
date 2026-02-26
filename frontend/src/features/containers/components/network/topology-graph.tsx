import { useCallback, useEffect, useMemo, useRef } from 'react';
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
} from '@/features/containers/hooks/use-elk-layout';
import { useForceSimulation } from '@/features/containers/hooks/use-force-simulation';
import { useUiStore } from '@/stores/ui-store';
import { TopologyLegend } from './topology-legend';

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
  selectedNodeId?: string;
  relatedNodeIds?: string[];
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

// Node dimensions for elkjs layout
const CONTAINER_W = 140;
const CONTAINER_H = 90;
const NETWORK_W = 140;
const NETWORK_H = 90;

// Layout options for within-group arrangement (elkjs compound graph)
const GROUP_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '200',
  'elk.spacing.nodeNode': '100',
  'elk.padding': '[top=50, left=40, bottom=30, right=40]',
};

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

/** Simplified blueprint: stack metadata + sorted members (elkjs handles positioning). */
interface StackBlueprint {
  stackName: string;
  groupId: string;
  containers: ContainerData[];
  inlineNets: NetworkData[];
}

export function TopologyGraph({
  containers,
  networks,
  onNodeClick,
  networkRates,
  selectedNodeId,
  relatedNodeIds,
}: TopologyGraphProps) {
  const potatoMode = useUiStore((state) => state.potatoMode);
  const relatedSet = useMemo(() => new Set(relatedNodeIds ?? []), [relatedNodeIds]);

  // Phase 1: Categorize stacks, classify inline/external networks, sort everything
  const { blueprints, externalNets } = useMemo(() => {
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
      const inlineNets = sortInlineNetworks(inlineNetsByStack.get(stackName) || [], stackContainerIds);

      blueprints.push({
        stackName,
        groupId: `stack-${stackName}`,
        containers: stackContainers,
        inlineNets,
      });
    }

    return { blueprints, externalNets };
  }, [containers, networks, networkRates]);

  // Phase 2: Build compound elkjs graph — groups with children + cross-hierarchy edges
  const { elkNodes, elkEdges } = useMemo(() => {
    const elkNodes: ElkLayoutNode[] = [];
    const elkEdges: ElkLayoutEdge[] = [];

    for (const bp of blueprints) {
      const children: ElkLayoutNode[] = [];
      const groupEdges: ElkLayoutEdge[] = [];

      // Inline networks as group children
      for (const net of bp.inlineNets) {
        children.push({ id: `net-${net.id}`, width: NETWORK_W, height: NETWORK_H });
      }

      // Containers as group children
      for (const container of bp.containers) {
        children.push({ id: `container-${container.id}`, width: CONTAINER_W, height: CONTAINER_H });

        for (const netName of container.networks) {
          // Intra-group edge (container → inline net within same stack)
          const inlineNet = bp.inlineNets.find((n) => n.name === netName);
          if (inlineNet) {
            groupEdges.push({
              id: `e-${container.id}-${inlineNet.id}`,
              source: `container-${container.id}`,
              target: `net-${inlineNet.id}`,
            });
            continue;
          }

          // Cross-hierarchy edge (container → external net)
          const extNet = externalNets.find((n) => n.name === netName);
          if (extNet) {
            elkEdges.push({
              id: `e-${container.id}-${extNet.id}`,
              source: `container-${container.id}`,
              target: `net-${extNet.id}`,
            });
          }
        }
      }

      elkNodes.push({
        id: bp.groupId,
        width: 0,
        height: 0,
        children,
        edges: groupEdges.length > 0 ? groupEdges : undefined,
        layoutOptions: GROUP_LAYOUT_OPTIONS,
      });
    }

    // External networks at root level
    for (const net of externalNets) {
      elkNodes.push({ id: `net-${net.id}`, width: NETWORK_W, height: NETWORK_H });
    }

    return { elkNodes, elkEdges };
  }, [blueprints, externalNets]);

  // Phase 3: Run elkjs compound layout (positions all nodes at all hierarchy levels)
  const layoutPositions = useElkLayout({ nodes: elkNodes, edges: elkEdges });

  // Phase 4: Assemble React Flow nodes and edges using elkjs-computed positions
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeAbsolutePositions = new Map<string, { x: number; y: number }>();

    for (const bp of blueprints) {
      const groupPos = layoutPositions.get(bp.groupId);
      if (!groupPos) continue;

      // Group node with elkjs-computed position and auto-sized dimensions
      nodes.push({
        id: bp.groupId,
        type: 'stack-group',
        position: { x: groupPos.x, y: groupPos.y },
        data: { label: bp.stackName },
        style: { width: groupPos.width ?? 200, height: groupPos.height ?? 150 },
      });

      // Inline nets (elkjs positions, relative to group)
      for (const net of bp.inlineNets) {
        const childId = `net-${net.id}`;
        const childPos = layoutPositions.get(childId);
        if (!childPos) continue;
        nodes.push({
          id: childId,
          type: 'network',
          position: { x: childPos.x, y: childPos.y },
          parentId: bp.groupId,
          extent: 'parent' as const,
          data: {
            label: net.name,
            driver: net.driver,
            subnet: net.subnet,
            selected: childId === selectedNodeId,
            related: relatedSet.has(childId),
          },
        });
        nodeAbsolutePositions.set(childId, {
          x: groupPos.x + childPos.x,
          y: groupPos.y + childPos.y,
        });
      }

      // Containers (elkjs positions, relative to group)
      for (const container of bp.containers) {
        const childId = `container-${container.id}`;
        const childPos = layoutPositions.get(childId);
        if (!childPos) continue;
        nodes.push({
          id: childId,
          type: 'container',
          position: { x: childPos.x, y: childPos.y },
          parentId: bp.groupId,
          extent: 'parent' as const,
          data: {
            label: container.name,
            state: container.state,
            image: container.image,
            selected: childId === selectedNodeId,
            related: relatedSet.has(childId),
          },
        });
        nodeAbsolutePositions.set(childId, {
          x: groupPos.x + childPos.x,
          y: groupPos.y + childPos.y,
        });
      }
    }

    // External network nodes (elkjs positions, absolute)
    for (const net of externalNets) {
      const netId = `net-${net.id}`;
      const pos = layoutPositions.get(netId);
      if (!pos) continue;
      nodes.push({
        id: netId,
        type: 'network',
        position: { x: pos.x, y: pos.y },
        data: {
          label: net.name,
          driver: net.driver,
          subnet: net.subnet,
          selected: netId === selectedNodeId,
          related: relatedSet.has(netId),
        },
      });
      nodeAbsolutePositions.set(netId, { x: pos.x, y: pos.y });
    }

    // Create React Flow edges for all container ↔ network connections
    for (const container of containers) {
      for (const netName of container.networks) {
        const net = networks.find((n) => n.name === netName);
        if (!net) continue;
        const sourceId = `container-${container.id}`;
        const targetId = `net-${net.id}`;
        const sourcePos = nodeAbsolutePositions.get(sourceId);
        const targetPos = nodeAbsolutePositions.get(targetId);
        const handles = sourcePos && targetPos
          ? getBestHandles(sourcePos, targetPos)
          : { sourceHandle: 'bottom' as HandleDirection, targetHandle: 'top' as HandleDirection };

        const edgeStyle = getEdgeStyle(container.id, container.state, networkRates);
        const rate = networkRates?.[container.id];
        const edgeLabel = rate ? `↓${formatRate(rate.rxBytesPerSec)} ↑${formatRate(rate.txBytesPerSec)}` : undefined;
        edges.push({
          id: `e-${container.id}-${net.id}`,
          source: sourceId,
          target: targetId,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          type: 'smoothstep',
          animated: !potatoMode && container.state === 'running',
          style: {
            stroke: edgeStyle.stroke,
            strokeWidth: edgeStyle.strokeWidth,
            opacity: 0.7,
          },
          label: edgeLabel,
          labelStyle: { fontSize: 10, fill: 'var(--color-muted-foreground)' },
          labelBgStyle: { fill: 'var(--color-card)', opacity: 0.9 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
        });
      }
    }

    return { nodes, edges };
  }, [blueprints, externalNets, layoutPositions, containers, networks, networkRates, relatedSet, selectedNodeId, potatoMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // --- Force simulation: top-level nodes push each other when dragged ---

  // Build simulation input from elkjs top-level node positions
  const simNodes = useMemo(() => {
    const result: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const bp of blueprints) {
      const pos = layoutPositions.get(bp.groupId);
      if (!pos) continue;
      result.push({
        id: bp.groupId,
        x: pos.x,
        y: pos.y,
        width: pos.width ?? 200,
        height: pos.height ?? 150,
      });
    }
    for (const net of externalNets) {
      const pos = layoutPositions.get(`net-${net.id}`);
      if (!pos) continue;
      result.push({
        id: `net-${net.id}`,
        x: pos.x,
        y: pos.y,
        width: NETWORK_W,
        height: NETWORK_H,
      });
    }
    return result;
  }, [blueprints, externalNets, layoutPositions]);

  // Build top-level links (group ↔ external net) for force simulation
  const simLinks = useMemo(() => {
    const links: Array<{ id: string; source: string; target: string }> = [];
    const seen = new Set<string>();
    for (const bp of blueprints) {
      for (const container of bp.containers) {
        for (const netName of container.networks) {
          const extNet = externalNets.find((n) => n.name === netName);
          if (!extNet) continue;
          const key = `${bp.groupId}--net-${extNet.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          links.push({ id: key, source: bp.groupId, target: `net-${extNet.id}` });
        }
      }
    }
    return links;
  }, [blueprints, externalNets]);

  // Track which node IDs are children of which group, for moving children with groups
  const childToGroupRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const bp of blueprints) {
      for (const c of bp.containers) map.set(`container-${c.id}`, bp.groupId);
      for (const n of bp.inlineNets) map.set(`net-${n.id}`, bp.groupId);
    }
    childToGroupRef.current = map;
  }, [blueprints]);

  // On simulation tick: update top-level node positions; children follow via React Flow parentId
  const handleSimTick = useCallback((positions: Map<string, { x: number; y: number }>) => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const newPos = positions.get(node.id);
        if (newPos) {
          // Top-level node (group or external net) — apply simulation position
          return { ...node, position: { x: newPos.x, y: newPos.y } };
        }
        return node;
      }),
    );
  }, [setNodes]);

  const { onNodeDragStart, onNodeDrag, onNodeDragStop } = useForceSimulation({
    nodes: simNodes,
    links: simLinks,
    onTick: handleSimTick,
  });

  // Wrap drag handlers to translate React Flow events into our hook's API
  const handleDragStart = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Only top-level nodes participate in simulation (groups + external nets)
      const groupId = childToGroupRef.current.get(node.id);
      if (groupId) return; // child node — let React Flow handle normally (constrained to parent)
      onNodeDragStart(event, node.id);
    },
    [onNodeDragStart],
  );

  const handleDrag = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const groupId = childToGroupRef.current.get(node.id);
      if (groupId) return;
      onNodeDrag(event, node.id, node.position);
    },
    [onNodeDrag],
  );

  const handleDragStop = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const groupId = childToGroupRef.current.get(node.id);
      if (groupId) return;
      onNodeDragStop(event, node.id);
    },
    [onNodeDragStop],
  );

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
    <div className="h-full rounded-lg border relative">
      <TopologyLegend />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStart={potatoMode ? undefined : handleDragStart}
        onNodeDrag={potatoMode ? undefined : handleDrag}
        onNodeDragStop={potatoMode ? undefined : handleDragStop}
        nodeTypes={nodeTypes}
        nodesDraggable={!potatoMode}
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

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)}MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)}KB/s`;
  return `${Math.round(bytesPerSec)}B/s`;
}
