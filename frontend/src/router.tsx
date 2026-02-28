import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/features/core/components/layout/app-layout';
import { RouteErrorBoundary } from '@/shared/components/route-error-boundary';
import { ChunkLoadErrorBoundary } from '@/shared/components/chunk-load-error-boundary';

// Lazy-loaded pages
const Login = lazy(() => import('@/features/core/pages/login'));
const AuthCallback = lazy(() => import('@/features/core/pages/auth-callback'));
const Home = lazy(() => import('@/features/core/pages/home'));
const WorkloadExplorer = lazy(() => import('@/features/containers/pages/workload-explorer'));
const Infrastructure = lazy(() => import('@/features/containers/pages/fleet-overview'));
const ContainerHealth = lazy(() => import('@/features/containers/pages/container-health'));
const ImageFootprint = lazy(() => import('@/features/containers/pages/image-footprint'));
const NetworkTopology = lazy(() => import('@/features/containers/pages/network-topology'));
const AiMonitor = lazy(() => import('@/features/ai-intelligence/pages/ai-monitor'));
const MetricsDashboard = lazy(() => import('@/features/observability/pages/metrics-dashboard'));
const Remediation = lazy(() => import('@/features/operations/pages/remediation'));
const TraceExplorer = lazy(() => import('@/features/observability/pages/trace-explorer'));
const LlmAssistant = lazy(() => import('@/features/ai-intelligence/pages/llm-assistant'));
const LlmObservability = lazy(() => import('@/features/ai-intelligence/pages/llm-observability'));
const EdgeAgentLogs = lazy(() => import('@/features/operations/pages/edge-agent-logs'));
const Settings = lazy(() => import('@/features/core/pages/settings'));
const Backups = lazy(() => import('@/features/core/pages/backups'));
const ContainerDetail = lazy(() => import('@/features/containers/pages/container-detail'));
const PacketCapture = lazy(() => import('@/features/security/pages/packet-capture'));
const ContainerComparison = lazy(() => import('@/features/containers/pages/container-comparison'));
const StatusPage = lazy(() => import('@/features/observability/pages/status-page'));
const Reports = lazy(() => import('@/features/observability/pages/reports'));
const LogViewer = lazy(() => import('@/features/observability/pages/log-viewer'));
const InvestigationDetail = lazy(() => import('@/features/ai-intelligence/pages/investigation-detail'));
const SecurityAudit = lazy(() => import('@/features/security/pages/security-audit'));
const EbpfCoverage = lazy(() => import('@/features/security/pages/ebpf-coverage'));
const HarborVulnerabilities = lazy(() => import('@/features/security/pages/harbor-vulnerabilities'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <ChunkLoadErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ChunkLoadErrorBoundary>
  );
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LazyPage><Login /></LazyPage>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/auth/callback',
    element: <LazyPage><AuthCallback /></LazyPage>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/status',
    element: <LazyPage><StatusPage /></LazyPage>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <LazyPage><Home /></LazyPage> },
      { path: 'workloads', element: <LazyPage><WorkloadExplorer /></LazyPage> },
      { path: 'infrastructure', element: <LazyPage><Infrastructure /></LazyPage> },
      { path: 'fleet', element: <Navigate to="/infrastructure?tab=fleet" replace /> },
      { path: 'stacks', element: <Navigate to="/infrastructure?tab=stacks" replace /> },
      { path: 'containers/:endpointId/:containerId', element: <LazyPage><ContainerDetail /></LazyPage> },
      { path: 'health', element: <LazyPage><ContainerHealth /></LazyPage> },
      { path: 'comparison', element: <LazyPage><ContainerComparison /></LazyPage> },
      { path: 'images', element: <LazyPage><ImageFootprint /></LazyPage> },
      { path: 'topology', element: <LazyPage><NetworkTopology /></LazyPage> },
      { path: 'ai-monitor', element: <LazyPage><AiMonitor /></LazyPage> },
      { path: 'metrics', element: <LazyPage><MetricsDashboard /></LazyPage> },
      { path: 'remediation', element: <LazyPage><Remediation /></LazyPage> },
      { path: 'traces', element: <LazyPage><TraceExplorer /></LazyPage> },
      { path: 'ebpf-coverage', element: <LazyPage><EbpfCoverage /></LazyPage> },
      { path: 'assistant', element: <LazyPage><LlmAssistant /></LazyPage> },
      { path: 'llm-observability', element: <LazyPage><LlmObservability /></LazyPage> },
      { path: 'edge-logs', element: <LazyPage><EdgeAgentLogs /></LazyPage> },
      { path: 'logs', element: <LazyPage><LogViewer /></LazyPage> },
      { path: 'security/audit', element: <LazyPage><SecurityAudit /></LazyPage> },
      { path: 'security/vulnerabilities', element: <LazyPage><HarborVulnerabilities /></LazyPage> },
      { path: 'packet-capture', element: <LazyPage><PacketCapture /></LazyPage> },
      { path: 'reports', element: <LazyPage><Reports /></LazyPage> },
      { path: 'webhooks', element: <Navigate to="/settings?tab=webhooks" replace /> },
      { path: 'users', element: <Navigate to="/settings?tab=users" replace /> },
      { path: 'investigations/:id', element: <LazyPage><InvestigationDetail /></LazyPage> },
      { path: 'investigations/insight/:insightId', element: <LazyPage><InvestigationDetail /></LazyPage> },
      { path: 'backups', element: <LazyPage><Backups /></LazyPage> },
      { path: 'settings', element: <LazyPage><Settings /></LazyPage> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace />, errorElement: <RouteErrorBoundary /> },
]);
