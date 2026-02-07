import type { Container } from '@/hooks/use-containers';
import type { Network } from '@/hooks/use-networks';

export function normalizeSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function getContainerStackName(container: Container): string {
  return container.labels['com.docker.compose.project'] || 'Standalone';
}

export function matchesContainerSearch(container: Container, term: string): boolean {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) return true;
  const stackName = getContainerStackName(container);
  return [container.name, container.image, stackName]
    .some(value => value.toLowerCase().includes(normalized));
}

export function matchesNetworkSearch(network: Network, term: string): boolean {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) return true;
  return network.name.toLowerCase().includes(normalized);
}

export function filterTopologyData(
  containers: Container[],
  networks: Network[],
  term: string,
): {
  containers: Container[];
  networks: Network[];
  matchedContainerIds: Set<string>;
  matchedNetworkIds: Set<string>;
} {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) {
    return {
      containers,
      networks,
      matchedContainerIds: new Set(),
      matchedNetworkIds: new Set(),
    };
  }

  const matchedContainers = containers.filter(container => matchesContainerSearch(container, normalized));
  const matchedContainerIds = new Set(matchedContainers.map(container => container.id));

  const matchedNetworkIds = new Set(
    networks
      .filter(network => matchesNetworkSearch(network, normalized))
      .map(network => network.id),
  );

  for (const network of networks) {
    if (network.containers.some(containerId => matchedContainerIds.has(containerId))) {
      matchedNetworkIds.add(network.id);
    }
  }

  const containersByNetwork = new Set<string>();
  for (const network of networks) {
    if (matchedNetworkIds.has(network.id)) {
      network.containers.forEach(containerId => containersByNetwork.add(containerId));
    }
  }

  const filteredContainers = containers.filter(container => (
    matchedContainerIds.has(container.id) || containersByNetwork.has(container.id)
  ));

  const filteredNetworks = networks.filter(network => matchedNetworkIds.has(network.id));

  const finalContainerIds = new Set(filteredContainers.map(container => container.id));

  return {
    containers: filteredContainers,
    networks: filteredNetworks,
    matchedContainerIds: finalContainerIds,
    matchedNetworkIds,
  };
}
