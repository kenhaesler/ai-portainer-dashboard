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

interface ContainerData {
  id: string;
  name: string;
  state: 'running' | 'stopped' | 'paused' | 'unknown';
  image: string;
  networks: string[];
  labels: Record<string, string>;
}

interface NetworkData {
  id: string;
  name: string;
  driver?: string;
  subnet?: string;
  containers: string[];
}

interface NetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

interface TopologyGraphProps {
  containers: ContainerData[];
  networks: NetworkData[];
  onNodeClick?: (nodeId: string) => void;
  networkRates?: Record<string, NetworkRate>;
}

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

    // Sort stacks: named stacks first (alphabetical), Standalone last
    const stackNames = Array.from(stackMap.keys()).sort((a, b) => {
      if (a === 'Standalone') return 1;
      if (b === 'Standalone') return -1;
      return a.localeCompare(b);
    });

    // Create stack group nodes and position containers inside them
    let groupY = GROUP_START_Y;

    for (const stackName of stackNames) {
      const stackContainers = stackMap.get(stackName)!;
      const cols = Math.min(stackContainers.length, CONTAINERS_PER_ROW);
      const rows = Math.ceil(stackContainers.length / CONTAINERS_PER_ROW);

      const groupWidth = GROUP_PADDING_X * 2 + cols * CONTAINER_SPACING_X;
      const groupHeight = GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM + rows * CONTAINER_SPACING_Y;

      const groupId = `stack-${stackName}`;

      // Group node
      nodes.push({
        id: groupId,
        type: 'stack-group',
        position: { x: GROUP_START_X, y: groupY },
        data: { label: stackName },
        style: { width: groupWidth, height: groupHeight },
      });

      // Container nodes inside the group
      stackContainers.forEach((container, i) => {
        const row = Math.floor(i / CONTAINERS_PER_ROW);
        const col = i % CONTAINERS_PER_ROW;

        nodes.push({
          id: `container-${container.id}`,
          type: 'container',
          position: {
            x: GROUP_PADDING_X + col * CONTAINER_SPACING_X,
            y: GROUP_PADDING_TOP + row * CONTAINER_SPACING_Y,
          },
          parentId: groupId,
          extent: 'parent' as const,
          data: {
            label: container.name,
            state: container.state,
            image: container.image,
          },
        });

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

    // Network nodes on the left, vertically centered relative to groups
    const totalGroupsHeight = groupY - GROUP_SPACING_Y - GROUP_START_Y;
    const networksTotalHeight = networks.length * NETWORK_SPACING_Y;
    const networkStartY = NETWORK_START_Y + Math.max(0, (totalGroupsHeight - networksTotalHeight) / 2);

    networks.forEach((net, i) => {
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
      <div className="flex h-[600px] items-center justify-center text-muted-foreground">
        No topology data. Select an endpoint to view its network topology.
      </div>
    );
  }

  return (
    <div className="h-[600px] rounded-lg border">
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
