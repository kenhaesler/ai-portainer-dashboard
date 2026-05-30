import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface ServiceNode {
  id: string;
  name: string;
  callCount: number;
  avgDuration: number;
  errorRate: number;
}

interface ServiceEdge {
  source: string;
  target: string;
  callCount: number;
  avgDuration: number;
}

interface ServiceMapProps {
  serviceNodes: ServiceNode[];
  serviceEdges: ServiceEdge[];
}

export function ServiceMap({ serviceNodes, serviceEdges }: ServiceMapProps) {
  const initialNodes: Node[] = serviceNodes.map((node, i) => ({
    id: node.id,
    position: {
      x: 150 + (i % 3) * 250,
      y: 100 + Math.floor(i / 3) * 150,
    },
    data: {
      label: (
        <div className="text-center">
          <div className="font-semibold text-sm">{node.name}</div>
          <div className="text-xs text-muted-foreground">
            {node.callCount} calls | {node.avgDuration?.toFixed(0)}ms
          </div>
          {node.errorRate > 0 && (
            <div className="text-xs text-red-500">{(node.errorRate * 100).toFixed(1)}% errors</div>
          )}
        </div>
      ),
    },
    style: {
      border: node.errorRate > 0.1 ? '2px solid #ef4444' : '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '12px',
      background: 'var(--color-card)',
    },
  }));

  const initialEdges: Edge[] = serviceEdges.map((edge, i) => ({
    id: `e-${i}`,
    source: edge.source,
    target: edge.target,
    label: `${edge.callCount}x | ${edge.avgDuration?.toFixed(0)}ms`,
    animated: true,
    style: { stroke: '#6b7280' },
    labelStyle: { fontSize: 10 },
  }));

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  if (!serviceNodes.length) {
    return (
      <div className="flex h-[500px] items-center justify-center text-muted-foreground">
        No service map data
      </div>
    );
  }

  return (
    <div className="h-[500px] rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
