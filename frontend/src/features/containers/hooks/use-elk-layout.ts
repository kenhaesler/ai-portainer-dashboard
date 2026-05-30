import { useEffect, useRef, useState } from 'react';
import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';

export interface ElkLayoutNode {
  id: string;
  width: number;
  height: number;
  children?: ElkLayoutNode[];
  edges?: ElkLayoutEdge[];
  layoutOptions?: Record<string, string>;
}

export interface ElkLayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface ElkLayoutInput {
  nodes: ElkLayoutNode[];
  edges: ElkLayoutEdge[];
  /**
   * Layout options applied to the synthetic root node. Pass a referentially
   * stable (module-level) object — it is part of the layout effect's deps, so a
   * fresh object each render would re-trigger the effect. Defaults to
   * DEFAULT_ROOT_LAYOUT_OPTIONS.
   */
  rootLayoutOptions?: Record<string, string>;
}

export interface LayoutPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const elk = new ELK();

export const DEFAULT_ROOT_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '200',
  'elk.spacing.nodeNode': '80',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
};

/** Build a stable string key from the input so we skip redundant layout runs. */
export function buildCacheKey(nodes: ElkLayoutNode[], edges: ElkLayoutEdge[]): string {
  const nodeKey = nodes.map((n) => {
    const childKey = n.children?.map((c) => `${c.id}:${c.width}:${c.height}`).join(';') ?? '';
    const edgeKey = n.edges?.map((e) => e.id).join(';') ?? '';
    return `${n.id}:${n.width}:${n.height}[${childKey}]{${edgeKey}}`;
  }).join(',');
  const edgeKey = edges.map((e) => e.id).join(',');
  return `${nodeKey}|${edgeKey}`;
}

/** Recursively convert ElkLayoutNode → ElkNode for elkjs. */
function buildElkNode(node: ElkLayoutNode): ElkNode {
  const elkNode: ElkNode = { id: node.id };
  // Only set dimensions for leaf nodes; compound nodes (width=0) auto-size from children
  if (node.width > 0) elkNode.width = node.width;
  if (node.height > 0) elkNode.height = node.height;
  if (node.layoutOptions) elkNode.layoutOptions = node.layoutOptions;
  if (node.children?.length) elkNode.children = node.children.map(buildElkNode);
  if (node.edges?.length) {
    elkNode.edges = node.edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    }));
  }
  return elkNode;
}

/** Build the synthetic ELK root graph (pure; exported for testing). */
export function buildRootGraph(
  nodes: ElkLayoutNode[],
  edges: ElkLayoutEdge[],
  rootLayoutOptions: Record<string, string> = DEFAULT_ROOT_LAYOUT_OPTIONS,
): ElkNode {
  const children = nodes.map(buildElkNode);
  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));
  return { id: 'root', layoutOptions: rootLayoutOptions, children, edges: elkEdges };
}

/** Recursively extract positions (and auto-computed sizes) from elkjs result. */
function extractPositions(
  nodes: ElkNode[] | undefined,
  result: Map<string, LayoutPosition>,
): void {
  if (!nodes) return;
  for (const node of nodes) {
    result.set(node.id, {
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width,
      height: node.height,
    });
    if (node.children) {
      extractPositions(node.children, result);
    }
  }
}

/**
 * Runs an async elkjs layout on a (potentially compound) graph and returns
 * settled positions for all nodes at all hierarchy levels.
 * Compound nodes (with children, width/height = 0) are auto-sized by elkjs.
 * Results are cached by input key to avoid redundant computations.
 */
export function useElkLayout({ nodes, edges, rootLayoutOptions }: ElkLayoutInput) {
  const [positions, setPositions] = useState<Map<string, LayoutPosition>>(
    () => new Map(),
  );
  const cacheKeyRef = useRef('');

  // Include rootLayoutOptions in the cache key so changing the root algorithm
  // re-runs layout even when the node/edge structure is unchanged.
  const cacheKey = `${buildCacheKey(nodes, edges)}|root:${JSON.stringify(rootLayoutOptions ?? '')}`;

  useEffect(() => {
    if (cacheKey === cacheKeyRef.current) return;
    cacheKeyRef.current = cacheKey;

    if (nodes.length === 0) {
      setPositions(new Map());
      return;
    }

    const graph = buildRootGraph(nodes, edges, rootLayoutOptions);

    elk.layout(graph).then((result) => {
      const map = new Map<string, LayoutPosition>();
      extractPositions(result.children, map);
      setPositions(map);
    });
  }, [cacheKey, nodes, edges, rootLayoutOptions]);

  return positions;
}
