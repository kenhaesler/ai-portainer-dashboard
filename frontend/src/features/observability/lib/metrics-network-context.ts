import { NO_STACK_LABEL, resolveContainerStackName } from '@/features/containers/lib/container-stack-grouping';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Network } from '@/features/containers/hooks/use-networks';

export type MetricsNetworkScope = 'container' | 'stack' | 'endpoint';

export interface MetricsNetworkContextInput {
  containers: Container[];
  networks: Network[];
  scope: MetricsNetworkScope;
  selectedContainerId: string | null;
  selectedStack: string | null;
  knownStackNames: string[];
  maxContainers?: number;
}

export interface MetricsNetworkContextResult {
  containers: Container[];
  networks: Network[];
  relatedNodeIds: string[];
  isTruncated: boolean;
}

function byStateThenName(a: Container, b: Container) {
  const aRunning = a.state === 'running' ? 0 : 1;
  const bRunning = b.state === 'running' ? 0 : 1;
  if (aRunning !== bRunning) return aRunning - bRunning;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function buildContainerScopeContext(input: MetricsNetworkContextInput): MetricsNetworkContextResult {
  const selected = input.containers.find((container) => container.id === input.selectedContainerId);
  if (!selected) {
    return { containers: [], networks: [], relatedNodeIds: [], isTruncated: false };
  }

  const selectedNetworks = new Set(selected.networks);
  const scopedContainers = input.containers.filter((container) =>
    container.networks.some((networkName) => selectedNetworks.has(networkName))
  );

  const scopedNetworks = input.networks.filter((network) => selectedNetworks.has(network.name));

  const relatedContainerIds = scopedContainers
    .filter((container) => container.id !== selected.id)
    .map((container) => `container-${container.id}`);
  const relatedNetworkIds = scopedNetworks.map((network) => `net-${network.id}`);

  return {
    containers: scopedContainers,
    networks: scopedNetworks,
    relatedNodeIds: [...relatedContainerIds, ...relatedNetworkIds],
    isTruncated: false,
  };
}

function buildStackScopeContext(input: MetricsNetworkContextInput): MetricsNetworkContextResult {
  if (!input.selectedStack) {
    return { containers: input.containers, networks: input.networks, relatedNodeIds: [], isTruncated: false };
  }

  const scopedContainers = input.containers.filter((container) => {
    const stackName = resolveContainerStackName(container, input.knownStackNames) ?? NO_STACK_LABEL;
    return stackName === input.selectedStack;
  });

  const scopedContainerIds = new Set(scopedContainers.map((container) => container.id));
  const scopedNetworks = input.networks.filter((network) =>
    network.containers.some((containerId) => scopedContainerIds.has(containerId))
  );

  return {
    containers: scopedContainers,
    networks: scopedNetworks,
    relatedNodeIds: [],
    isTruncated: false,
  };
}

function buildEndpointScopeContext(input: MetricsNetworkContextInput): MetricsNetworkContextResult {
  const maxContainers = input.maxContainers ?? 80;
  if (input.containers.length <= maxContainers) {
    return { containers: input.containers, networks: input.networks, relatedNodeIds: [], isTruncated: false };
  }

  const limitedContainers = [...input.containers]
    .sort(byStateThenName)
    .slice(0, maxContainers);

  const limitedContainerIds = new Set(limitedContainers.map((container) => container.id));
  const limitedNetworks = input.networks.filter((network) =>
    network.containers.some((containerId) => limitedContainerIds.has(containerId))
  );

  return {
    containers: limitedContainers,
    networks: limitedNetworks,
    relatedNodeIds: [],
    isTruncated: true,
  };
}

export function buildMetricsNetworkContext(input: MetricsNetworkContextInput): MetricsNetworkContextResult {
  switch (input.scope) {
    case 'container':
      return buildContainerScopeContext(input);
    case 'stack':
      return buildStackScopeContext(input);
    case 'endpoint':
    default:
      return buildEndpointScopeContext(input);
  }
}
