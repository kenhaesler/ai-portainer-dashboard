import { useCallback, useEffect, useRef } from 'react';
import {
  forceSimulation,
  forceCollide,
  forceManyBody,
  forceLink,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

export interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
  /** Original position from elkjs layout (anchor point). */
  ox: number;
  oy: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
}

export interface ForceSimulationInput {
  /** Top-level nodes (groups + external nets) with positions and sizes. */
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  /** Links between top-level nodes. */
  links: Array<{ id: string; source: string; target: string }>;
  /** Called on every simulation tick with updated positions. */
  onTick: (positions: Map<string, { x: number; y: number }>) => void;
}

/**
 * Manages a d3-force simulation that activates only when nodes are dragged.
 * Returns drag handlers to wire into React Flow.
 */
export function useForceSimulation({ nodes, links, onTick }: ForceSimulationInput) {
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  // Rebuild simulation when graph structure changes
  useEffect(() => {
    if (nodes.length === 0) {
      simRef.current?.stop();
      simRef.current = null;
      return;
    }

    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      ox: n.x,
      oy: n.y,
      radius: Math.max(n.width, n.height) / 2,
    }));

    const nodeIndex = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = links
      .filter((l) => nodeIndex.has(l.source) && nodeIndex.has(l.target))
      .map((l) => ({
        id: l.id,
        source: nodeIndex.get(l.source)!,
        target: nodeIndex.get(l.target)!,
      }));

    simNodesRef.current = simNodes;

    const sim = forceSimulation<SimNode>(simNodes)
      .force('collide', forceCollide<SimNode>((d) => d.radius + 30).strength(0.8))
      .force('charge', forceManyBody<SimNode>().strength(-200).distanceMax(500))
      .force('link', forceLink<SimNode, SimLink>(simLinks).distance(250).strength(0.3))
      .force('x', forceX<SimNode>((d) => d.ox).strength(0.05))
      .force('y', forceY<SimNode>((d) => d.oy).strength(0.05))
      .alphaDecay(0.05)
      .velocityDecay(0.4)
      .alpha(0)
      .stop();

    sim.on('tick', () => {
      const positions = new Map<string, { x: number; y: number }>();
      for (const n of simNodes) {
        positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      }
      onTickRef.current(positions);
    });

    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [nodes, links]);

  const onNodeDragStart = useCallback((_event: React.MouseEvent, nodeId: string) => {
    const sim = simRef.current;
    if (!sim) return;
    const node = simNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    node.fx = node.x;
    node.fy = node.y;
    sim.alpha(0.3).restart();
  }, []);

  const onNodeDrag = useCallback((_event: React.MouseEvent, nodeId: string, position: { x: number; y: number }) => {
    const node = simNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    node.fx = position.x;
    node.fy = position.y;
  }, []);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, nodeId: string) => {
    const sim = simRef.current;
    if (!sim) return;
    const node = simNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    // Unpin the node and update its anchor to current position
    node.fx = null;
    node.fy = null;
    node.ox = node.x ?? 0;
    node.oy = node.y ?? 0;
  }, []);

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
