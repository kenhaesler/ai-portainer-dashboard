/**
 * Socket.IO namespace registration — wires all domain socket handlers to the
 * namespaces created by the core socket-io plugin.
 */
import type { Namespace } from 'socket.io';
import { setupLlmNamespace, setupMonitoringNamespace, setMonitoringNamespace, setInvestigationNamespace } from '@dashboard/ai';
import { setupRemediationNamespace } from '@dashboard/operations';
import type { InfrastructureLogsInterface } from '@dashboard/contracts';

export interface AppNamespaces {
  llm: Namespace;
  monitoring: Namespace;
  remediation: Namespace;
}

export function setupSockets(namespaces: AppNamespaces, infraLogs: InfrastructureLogsInterface): void {
  setupLlmNamespace(namespaces.llm, infraLogs);
  setupMonitoringNamespace(namespaces.monitoring);
  setupRemediationNamespace(namespaces.remediation);

  // Register monitoring namespace for real-time insight broadcasting
  setMonitoringNamespace(namespaces.monitoring);
  setInvestigationNamespace(namespaces.monitoring);
}
