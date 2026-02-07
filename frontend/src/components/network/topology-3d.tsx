import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force-3d';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { NetworkRate } from '@/hooks/use-metrics';
import { getContainerTraffic, getEdgeStyle, type ContainerData, type NetworkData } from './topology-graph';

interface Topology3DProps {
  containers: ContainerData[];
  networks: NetworkData[];
  onNodeClick?: (nodeId: string) => void;
  networkRates?: Record<string, NetworkRate>;
  searchMatches?: Set<string>;
}

interface TopologyNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: 'container' | 'network';
  state?: ContainerData['state'];
  image?: string;
  stack?: string;
  size: number;
  color: string;
  traffic: number;
}

interface TopologyLink extends SimulationLinkDatum<TopologyNode> {
  id: string;
  source: string;
  target: string;
  traffic: number;
  state?: ContainerData['state'];
}

function getLinkNodeId(node: string | TopologyNode): string {
  return typeof node === 'string' ? node : node.id;
}

const STATE_COLORS: Record<ContainerData['state'], string> = {
  running: '#10b981',
  paused: '#eab308',
  stopped: '#ef4444',
  unknown: '#6b7280',
};

const NETWORK_COLOR = '#38bdf8';

function getNodeScale(traffic: number, base: number): number {
  if (traffic <= 0) return base;
  const scaled = base + Math.min(1.6, Math.log10(traffic + 10));
  return Number.isFinite(scaled) ? scaled : base;
}

function buildTopology(
  containers: ContainerData[],
  networks: NetworkData[],
  networkRates?: Record<string, NetworkRate>,
): {
  nodes: TopologyNode[];
  links: TopologyLink[];
  adjacency: Map<string, Set<string>>;
} {
  const nodes: TopologyNode[] = [];
  const links: TopologyLink[] = [];
  const adjacency = new Map<string, Set<string>>();

  const networkByName = new Map(networks.map(network => [network.name, network]));

  containers.forEach(container => {
    const traffic = getContainerTraffic(container.id, networkRates);
    const stack = container.labels['com.docker.compose.project'] || 'Standalone';
    nodes.push({
      id: `container-${container.id}`,
      label: container.name,
      type: 'container',
      state: container.state,
      image: container.image,
      stack,
      size: getNodeScale(traffic, 1.2),
      color: STATE_COLORS[container.state] ?? STATE_COLORS.unknown,
      traffic,
    });
  });

  networks.forEach(network => {
    nodes.push({
      id: `net-${network.id}`,
      label: network.name,
      type: 'network',
      size: 1,
      color: NETWORK_COLOR,
      traffic: 0,
    });
  });

  containers.forEach(container => {
    container.networks.forEach(netName => {
      const network = networkByName.get(netName);
      if (!network) return;
      const traffic = getContainerTraffic(container.id, networkRates);
      links.push({
        id: `${container.id}-${network.id}`,
        source: `container-${container.id}`,
        target: `net-${network.id}`,
        traffic,
        state: container.state,
      });
    });
  });

  for (const link of links) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
    if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
    adjacency.get(link.source)!.add(link.target);
    adjacency.get(link.target)!.add(link.source);
  }

  if (nodes.length) {
    const simulation = forceSimulation(nodes)
      .force('link', forceLink<TopologyNode, TopologyLink>(links)
        .id(node => node.id)
        .distance((link) => {
          const source = typeof link.source === 'string'
            ? nodes.find(node => node.id === link.source)
            : link.source;
          return source?.type === 'network' ? 18 : 22;
        })
        .strength(0.7))
      .force('charge', forceManyBody().strength(-45))
      .force('center', forceCenter(0, 0, 0));

    simulation.stop();
    for (let i = 0; i < 220; i += 1) {
      simulation.tick();
    }
  }

  return { nodes, links, adjacency };
}

function FlowParticle({
  source,
  target,
  speed,
  color,
  dimmed,
}: {
  source: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  color: string;
  dimmed: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const progress = useRef(Math.random());
  const temp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    progress.current = (progress.current + delta * speed) % 1;
    temp.lerpVectors(source, target, progress.current);
    if (meshRef.current) {
      meshRef.current.position.copy(temp);
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.12, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.2 : 0.7} />
    </mesh>
  );
}

function CameraRig({
  focus,
  controls,
}: {
  focus: THREE.Vector3 | null;
  controls: React.MutableRefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const defaultPosition = useMemo(() => new THREE.Vector3(0, 0, 45), []);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const targetLook = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const damping = 1 - Math.exp(-delta * 3);
    if (focus) {
      targetLook.copy(focus);
      targetPosition.copy(focus).add(new THREE.Vector3(0, 0, 16));
    } else {
      targetLook.set(0, 0, 0);
      targetPosition.copy(defaultPosition);
    }

    camera.position.lerp(targetPosition, damping);
    if (controls.current) {
      controls.current.target.lerp(targetLook, damping);
      controls.current.update();
    }
  });

  return null;
}

export function Topology3D({ containers, networks, onNodeClick, networkRates, searchMatches }: Topology3DProps) {
  const { nodes, links, adjacency } = useMemo(
    () => buildTopology(containers, networks, networkRates),
    [containers, networks, networkRates],
  );

  const containerNodes = useMemo(() => nodes.filter(node => node.type === 'container'), [nodes]);
  const networkNodes = useMemo(() => nodes.filter(node => node.type === 'network'), [nodes]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    if (focusedId && !nodes.find(node => node.id === focusedId)) {
      setFocusedId(null);
    }
  }, [nodes, focusedId]);

  const highlightIds = useMemo(() => {
    const active = new Set<string>();
    if (hoveredId) {
      active.add(hoveredId);
      adjacency.get(hoveredId)?.forEach(id => active.add(id));
    }

    if (searchMatches && searchMatches.size > 0) {
      if (active.size === 0) {
        return new Set(searchMatches);
      }
      searchMatches.forEach(id => active.add(id));
    }

    return active.size > 0 ? active : null;
  }, [hoveredId, adjacency, searchMatches]);

  const focusNode = useMemo(
    () => nodes.find(node => node.id === focusedId) ?? null,
    [focusedId, nodes],
  );

  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const containerMeshRef = useRef<THREE.InstancedMesh>(null);
  const networkMeshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    if (containerMeshRef.current) {
      containerNodes.forEach((node, index) => {
        dummy.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        dummy.scale.setScalar(node.size);
        dummy.updateMatrix();
        containerMeshRef.current!.setMatrixAt(index, dummy.matrix);

        const color = new THREE.Color(node.color);
        if (highlightIds && !highlightIds.has(node.id)) {
          color.multiplyScalar(0.35);
        }
        containerMeshRef.current!.setColorAt(index, color);
      });
      containerMeshRef.current.instanceMatrix.needsUpdate = true;
      if (containerMeshRef.current.instanceColor) {
        containerMeshRef.current.instanceColor.needsUpdate = true;
      }
    }

    if (networkMeshRef.current) {
      networkNodes.forEach((node, index) => {
        dummy.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        dummy.scale.setScalar(node.size);
        dummy.updateMatrix();
        networkMeshRef.current!.setMatrixAt(index, dummy.matrix);

        const color = new THREE.Color(node.color);
        if (highlightIds && !highlightIds.has(node.id)) {
          color.multiplyScalar(0.35);
        }
        networkMeshRef.current!.setColorAt(index, color);
      });
      networkMeshRef.current.instanceMatrix.needsUpdate = true;
      if (networkMeshRef.current.instanceColor) {
        networkMeshRef.current.instanceColor.needsUpdate = true;
      }
    }
  }, [containerNodes, networkNodes, highlightIds]);

  if (!containers.length && !networks.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No topology data. Select an endpoint to view its network topology.
      </div>
    );
  }

  return (
    <div className="h-full rounded-lg border bg-card/30">
      <Canvas camera={{ position: [0, 0, 45], fov: 55 }}>
        <color attach="background" args={[new THREE.Color('transparent')]} />
        <ambientLight intensity={0.6} />
        <pointLight position={[30, 30, 30]} intensity={0.9} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          panSpeed={0.6}
        />
        <CameraRig focus={focusNode ? new THREE.Vector3(focusNode.x ?? 0, focusNode.y ?? 0, focusNode.z ?? 0) : null} controls={controlsRef} />

        {links.map(link => {
          const sourceId = getLinkNodeId(link.source);
          const targetId = getLinkNodeId(link.target);
          const sourceNode = nodes.find(node => node.id === sourceId);
          const targetNode = nodes.find(node => node.id === targetId);
          if (!sourceNode || !targetNode) return null;

          const source = new THREE.Vector3(sourceNode.x ?? 0, sourceNode.y ?? 0, sourceNode.z ?? 0);
          const target = new THREE.Vector3(targetNode.x ?? 0, targetNode.y ?? 0, targetNode.z ?? 0);
          const edgeStyle = getEdgeStyle(sourceId.replace('container-', ''), link.state ?? 'unknown', networkRates);
          const lineColor = edgeStyle.stroke;
          const lineWidth = Math.max(0.4, edgeStyle.strokeWidth * 0.25);
          const dimmed = Boolean(highlightIds && !highlightIds.has(sourceId) && !highlightIds.has(targetId));
          const speed = Math.min(1.8, Math.max(0.6, link.traffic / 150_000));

          return (
            <group key={link.id}>
              <Line
                points={[source, target]}
                color={lineColor}
                lineWidth={lineWidth}
                transparent
                opacity={dimmed ? 0.15 : 0.55}
              />
              <FlowParticle source={source} target={target} speed={speed} color={lineColor} dimmed={dimmed} />
            </group>
          );
        })}

        {containerNodes.length > 0 && (
          <instancedMesh
            ref={containerMeshRef}
            args={[undefined, undefined, containerNodes.length]}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (event.instanceId !== undefined) {
                setHoveredId(containerNodes[event.instanceId]?.id ?? null);
              }
            }}
            onPointerOut={() => setHoveredId(null)}
            onClick={(event) => {
              event.stopPropagation();
              const node = event.instanceId !== undefined ? containerNodes[event.instanceId] : null;
              if (node) {
                setFocusedId(node.id);
                onNodeClick?.(node.id);
              }
            }}
          >
            <sphereGeometry args={[0.7, 20, 20]} />
            <meshStandardMaterial emissiveIntensity={0.8} emissive={new THREE.Color('#0f172a')} />
          </instancedMesh>
        )}

        {networkNodes.length > 0 && (
          <instancedMesh
            ref={networkMeshRef}
            args={[undefined, undefined, networkNodes.length]}
            onPointerMove={(event) => {
              event.stopPropagation();
              if (event.instanceId !== undefined) {
                setHoveredId(networkNodes[event.instanceId]?.id ?? null);
              }
            }}
            onPointerOut={() => setHoveredId(null)}
            onClick={(event) => {
              event.stopPropagation();
              const node = event.instanceId !== undefined ? networkNodes[event.instanceId] : null;
              if (node) {
                setFocusedId(node.id);
                onNodeClick?.(node.id);
              }
            }}
          >
            <sphereGeometry args={[0.5, 16, 16]} />
            <meshStandardMaterial emissiveIntensity={0.6} emissive={new THREE.Color('#0f172a')} />
          </instancedMesh>
        )}

        {focusNode && (
          <Html position={[focusNode.x ?? 0, focusNode.y ?? 0, focusNode.z ?? 0]} distanceFactor={10}>
            <div className="rounded-lg border bg-card/90 p-3 text-xs shadow-lg backdrop-blur">
              <div className="font-semibold text-foreground">{focusNode.label}</div>
              {focusNode.type === 'container' ? (
                <div className="text-muted-foreground">{focusNode.image}</div>
              ) : (
                <div className="text-muted-foreground">Network</div>
              )}
            </div>
          </Html>
        )}
      </Canvas>
    </div>
  );
}
