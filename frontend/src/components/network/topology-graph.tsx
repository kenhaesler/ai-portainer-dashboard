import { useCallback, useMemo } from 'react';
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

interface ContainerData {
  id: string;
  name: string;
  state: 'running' | 'stopped' | 'paused' | 'unknown';
  image: string;
  networks: string[];
}

interface NetworkData {
  id: string;
  name: string;
  driver?: string;
  subnet?: string;
  containers: string[];
}

interface TopologyGraphProps {
  containers: ContainerData[];
  networks: NetworkData[];
}

const nodeTypes = {
  container: ContainerNode,
  network: NetworkNode,
};

export function TopologyGraph({ containers, networks }: TopologyGraphProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Network nodes (centered)
    networks.forEach((net, i) => {
      nodes.push({
        id: `net-${net.id}`,
        type: 'network',
        position: { x: 400, y: 100 + i * 200 },
        data: {
          label: net.name,
          driver: net.driver,
          subnet: net.subnet,
        },
      });
    });

    // Container nodes
    containers.forEach((container, i) => {
      const row = Math.floor(i / 4);
      const col = i % 4;
      nodes.push({
        id: `container-${container.id}`,
        type: 'container',
        position: { x: 50 + col * 200, y: 50 + row * 120 + (networks.length * 200) + 100 },
        data: {
          label: container.name,
          state: container.state,
          image: container.image,
        },
      });

      // Connect to networks
      container.networks.forEach((netName) => {
        const net = networks.find((n) => n.name === netName);
        if (net) {
          edges.push({
            id: `e-${container.id}-${net.id}`,
            source: `container-${container.id}`,
            target: `net-${net.id}`,
            animated: container.state === 'running',
            style: {
              stroke: container.state === 'running' ? '#10b981' : '#6b7280',
            },
          });
        }
      });
    });

    return { nodes, edges };
  }, [containers, networks]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

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
