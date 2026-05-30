/**
 * Abstract interface for infrastructure log access.
 * Implemented by @dashboard/infrastructure.
 * Injected into @dashboard/ai (llm-tools) to break the ai-intelligence → infrastructure import cycle.
 */
export interface InfrastructureLogsInterface {
  /**
   * Fetch container logs with retry logic for edge/tunnel scenarios.
   */
  getContainerLogsWithRetry(
    endpointId: number,
    containerId: string,
    options?: { tail?: number; since?: number; until?: number; timestamps?: boolean },
  ): Promise<string>;

  /**
   * Whether the endpoint uses async edge log retrieval.
   */
  isEdgeAsync(endpointId: number): Promise<boolean>;

  /**
   * Fetch container logs via async edge agent protocol.
   */
  getEdgeAsyncContainerLogs(
    endpointId: number,
    containerId: string,
    options?: { tail?: number },
  ): Promise<string>;
}
