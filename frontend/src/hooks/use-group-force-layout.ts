import { useMemo, useRef } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceCenter,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

export interface GroupForceNode extends SimulationNodeDatum {
  id: string;
  /** Collision radius (half-diagonal of the group bounding box) */
  radius: number;
}

export interface GroupForceLink extends SimulationLinkDatum<GroupForceNode> {
  id: string;
}

export interface GroupForceInput {
  /** Group/external-net nodes with initial positions and sizes */
  nodes: GroupForceNode[];
  /** Links between groups (shared external networks create links) */
  links: GroupForceLink[];
}

/** Build a stable string key from the input so useMemo doesn't rerun on every render. */
function buildCacheKey(nodes: GroupForceNode[], links: GroupForceLink[]): string {
  const nodeKey = nodes.map((n) => `${n.id}:${n.radius}`).join(',');
  const linkKey = links.map((l) => l.id).join(',');
  return `${nodeKey}|${linkKey}`;
}

/**
 * Runs a synchronous d3-force simulation on group-level nodes and returns
 * settled positions. The simulation runs to completion (no animation) so
 * the result is deterministic for the same input.
 */
export function useGroupForceLayout({ nodes, links }: GroupForceInput) {
  const cacheKey = buildCacheKey(nodes, links);
  const prevKey = useRef('');
  const prevResult = useRef(new Map<string, { x: number; y: number }>());

  return useMemo(() => {
    // Skip recomputation if input hasn't actually changed
    if (cacheKey === prevKey.current) return prevResult.current;
    prevKey.current = cacheKey;

    if (nodes.length === 0) {
      prevResult.current = new Map();
      return prevResult.current;
    }

    // Clone nodes with spread initial positions so they don't all start at (0,0)
    const simNodes = nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const spread = 200 + nodes.length * 50;
      return {
        ...n,
        x: n.x || spread * Math.cos(angle),
        y: n.y || spread * Math.sin(angle),
      };
    });
    const simLinks = links.map((l) => ({ ...l }));

    const sim = forceSimulation<GroupForceNode, GroupForceLink>(simNodes)
      .force(
        'link',
        forceLink<GroupForceNode, GroupForceLink>(simLinks)
          .id((d) => d.id)
          .distance(350)
          .strength(0.4),
      )
      .force('charge', forceManyBody().strength(-800))
      .force(
        'collide',
        forceCollide<GroupForceNode>((d) => d.radius + 40),
      )
      .force('center', forceCenter(0, 0))
      .stop();

    // Run simulation to completion synchronously
    const iterations = 300;
    for (let i = 0; i < iterations; i++) {
      sim.tick();
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const node of simNodes) {
      positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
    }

    prevResult.current = positions;
    return positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
}
