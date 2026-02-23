/**
 * Test helper — checks Portainer connectivity and fetches real data for assertions.
 */
import { getConfig } from '../core/config/index.js';

/**
 * Check if Portainer API is reachable.
 */
export async function isPortainerAvailable(): Promise<boolean> {
  try {
    const config = getConfig();
    const url = config.PORTAINER_API_URL;
    if (!url) return false;
    const res = await fetch(`${url}/api/status`, {
      headers: { 'X-API-Key': config.PORTAINER_API_KEY },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch real endpoints from Portainer for test assertions.
 */
export async function getTestEndpoints(): Promise<any[]> {
  const config = getConfig();
  const res = await fetch(`${config.PORTAINER_API_URL}/api/endpoints`, {
    headers: { 'X-API-Key': config.PORTAINER_API_KEY },
  });
  if (!res.ok) throw new Error(`Portainer endpoints fetch failed: ${res.status}`);
  return (await res.json()) as any[];
}

/**
 * Fetch real containers from a Portainer endpoint for test assertions.
 */
export async function getTestContainers(endpointId: number): Promise<any[]> {
  const config = getConfig();
  const res = await fetch(
    `${config.PORTAINER_API_URL}/api/endpoints/${endpointId}/docker/containers/json?all=true`,
    { headers: { 'X-API-Key': config.PORTAINER_API_KEY } },
  );
  if (!res.ok) throw new Error(`Portainer containers fetch failed: ${res.status}`);
  return (await res.json()) as any[];
}
