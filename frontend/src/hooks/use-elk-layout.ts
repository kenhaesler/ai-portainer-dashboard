import { useEffect, useRef, useState } from 'react';
import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';

export interface ElkLayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface ElkLayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface ElkLayoutInput {
  nodes: ElkLayoutNode[];
  edges: ElkLayoutEdge[];
}

const elk = new ELK();

const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
};

/** Build a stable string key from the input so we skip redundant layout runs. */
function buildCacheKey(nodes: ElkLayoutNode[], edges: ElkLayoutEdge[]): string {
  const nodeKey = nodes.map((n) => `${n.id}:${n.width}:${n.height}`).join(',');
  const edgeKey = edges.map((e) => e.id).join(',');
  return `${nodeKey}|${edgeKey}`;
}

/**
 * Runs an async elkjs layout on a flat set of nodes and returns
 * settled positions. Results are cached by input key to avoid
 * redundant computations.
 */
export function useElkLayout({ nodes, edges }: ElkLayoutInput) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const cacheKeyRef = useRef('');

  const cacheKey = buildCacheKey(nodes, edges);

  useEffect(() => {
    if (cacheKey === cacheKeyRef.current) return;
    cacheKeyRef.current = cacheKey;

    if (nodes.length === 0) {
      setPositions(new Map());
      return;
    }

    const elkNodes: ElkNode[] = nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    }));

    const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    }));

    const graph: ElkNode = {
      id: 'root',
      layoutOptions: LAYOUT_OPTIONS,
      children: elkNodes,
      edges: elkEdges,
    };

    elk.layout(graph).then((result) => {
      const map = new Map<string, { x: number; y: number }>();
      for (const child of result.children ?? []) {
        map.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
      }
      setPositions(map);
    });
  }, [cacheKey, nodes, edges]);

  return positions;
}
