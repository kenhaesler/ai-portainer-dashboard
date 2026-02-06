import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/app-layout';
import { RouteErrorBoundary } from '@/components/shared/route-error-boundary';

// Lazy-loaded pages
const Login = lazy(() => import('@/pages/login'));
const AuthCallback = lazy(() => import('@/pages/auth-callback'));
const Home = lazy(() => import('@/pages/home'));
const WorkloadExplorer = lazy(() => import('@/pages/workload-explorer'));
const FleetOverview = lazy(() => import('@/pages/fleet-overview'));
const ContainerHealth = lazy(() => import('@/pages/container-health'));
const ImageFootprint = lazy(() => import('@/pages/image-footprint'));
const NetworkTopology = lazy(() => import('@/pages/network-topology'));
const AiMonitor = lazy(() => import('@/pages/ai-monitor'));
const MetricsDashboard = lazy(() => import('@/pages/metrics-dashboard'));
const Remediation = lazy(() => import('@/pages/remediation'));
const TraceExplorer = lazy(() => import('@/pages/trace-explorer'));
const LlmAssistant = lazy(() => import('@/pages/llm-assistant'));
const LlmObservability = lazy(() => import('@/pages/llm-observability'));
const EdgeAgentLogs = lazy(() => import('@/pages/edge-agent-logs'));
const Settings = lazy(() => import('@/pages/settings'));
const Backups = lazy(() => import('@/pages/backups'));
const StackOverview = lazy(() => import('@/pages/stack-overview'));
const ContainerDetail = lazy(() => import('@/pages/container-detail'));
const PacketCapture = lazy(() => import('@/pages/packet-capture'));
const ContainerComparison = lazy(() => import('@/pages/container-comparison'));
const StatusPage = lazy(() => import('@/pages/status-page'));
const Reports = lazy(() => import('@/pages/reports'));
const LogViewer = lazy(() => import('@/pages/log-viewer'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
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
      { path: 'fleet', element: <LazyPage><FleetOverview /></LazyPage> },
      { path: 'stacks', element: <LazyPage><StackOverview /></LazyPage> },
      { path: 'containers/:endpointId/:containerId', element: <LazyPage><ContainerDetail /></LazyPage> },
      { path: 'health', element: <LazyPage><ContainerHealth /></LazyPage> },
      { path: 'comparison', element: <LazyPage><ContainerComparison /></LazyPage> },
      { path: 'images', element: <LazyPage><ImageFootprint /></LazyPage> },
      { path: 'topology', element: <LazyPage><NetworkTopology /></LazyPage> },
      { path: 'ai-monitor', element: <LazyPage><AiMonitor /></LazyPage> },
      { path: 'metrics', element: <LazyPage><MetricsDashboard /></LazyPage> },
      { path: 'remediation', element: <LazyPage><Remediation /></LazyPage> },
      { path: 'traces', element: <LazyPage><TraceExplorer /></LazyPage> },
      { path: 'assistant', element: <LazyPage><LlmAssistant /></LazyPage> },
      { path: 'llm-observability', element: <LazyPage><LlmObservability /></LazyPage> },
      { path: 'edge-logs', element: <LazyPage><EdgeAgentLogs /></LazyPage> },
      { path: 'logs', element: <LazyPage><LogViewer /></LazyPage> },
      { path: 'packet-capture', element: <LazyPage><PacketCapture /></LazyPage> },
      { path: 'reports', element: <LazyPage><Reports /></LazyPage> },
      { path: 'backups', element: <LazyPage><Backups /></LazyPage> },
      { path: 'settings', element: <LazyPage><Settings /></LazyPage> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace />, errorElement: <RouteErrorBoundary /> },
]);
