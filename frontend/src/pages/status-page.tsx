import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  Server,
  Container,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface UptimeBucket {
  date: string;
  uptime_pct: number;
}

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  summary: string | null;
}

interface StatusData {
  title: string;
  description: string;
  overallStatus: 'operational' | 'degraded' | 'major_outage';
  uptime: { '24h': number; '7d': number; '30d': number };
  endpointUptime: { '24h': number; '7d': number; '30d': number };
  snapshot: {
    containersRunning: number;
    containersStopped: number;
    containersUnhealthy: number;
    endpointsUp: number;
    endpointsDown: number;
    lastChecked: string;
  } | null;
  uptimeTimeline: UptimeBucket[];
  recentIncidents?: Incident[];
  autoRefreshSeconds: number;
}

const STATUS_CONFIG = {
  operational: {
    label: 'All Systems Operational',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Partial System Degradation',
    color: 'text-yellow-600',
    bg: 'bg-yellow-50 border-yellow-200',
    icon: AlertTriangle,
  },
  major_outage: {
    label: 'Major Outage',
    color: 'text-red-600',
    bg: 'bg-red-50 border-red-200',
    icon: XCircle,
  },
} as const;

function uptimeColor(pct: number): string {
  if (pct >= 99.9) return 'bg-emerald-500';
  if (pct >= 99) return 'bg-emerald-400';
  if (pct >= 95) return 'bg-yellow-400';
  if (pct >= 90) return 'bg-orange-400';
  return 'bg-red-500';
}

function uptimeTooltipColor(pct: number): string {
  if (pct >= 99.9) return 'text-emerald-600';
  if (pct >= 99) return 'text-emerald-500';
  if (pct >= 95) return 'text-yellow-600';
  if (pct >= 90) return 'text-orange-600';
  return 'text-red-600';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function UptimeTimeline({ buckets }: { buckets: UptimeBucket[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Fill missing days with 100% for a clean 90-day view
  const last90 = buckets.slice(-90);

  return (
    <div className="relative">
      <div className="flex gap-[2px]">
        {last90.map((bucket, i) => (
          <div
            key={bucket.date}
            className={cn(
              'flex-1 h-8 rounded-sm transition-all cursor-pointer min-w-[2px]',
              uptimeColor(bucket.uptime_pct),
              hovered === i && 'ring-2 ring-offset-1 ring-gray-400',
            )}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            title={`${bucket.date}: ${bucket.uptime_pct}%`}
          />
        ))}
      </div>
      {hovered !== null && last90[hovered] && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm z-10 whitespace-nowrap">
          <span className="font-medium">{last90[hovered].date}</span>
          <span className={cn('ml-2 font-semibold', uptimeTooltipColor(last90[hovered].uptime_pct))}>
            {last90[hovered].uptime_pct}%
          </span>
        </div>
      )}
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{last90.length > 0 ? last90[0].date : ''}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function IncidentItem({ incident }: { incident: Incident }) {
  const isResolved = incident.status === 'resolved';

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block w-2 h-2 rounded-full',
                incident.severity === 'critical' ? 'bg-red-500' :
                incident.severity === 'warning' ? 'bg-yellow-500' : 'bg-blue-500',
              )}
            />
            <span className="font-medium text-gray-900">{incident.title}</span>
          </div>
          {incident.summary && (
            <p className="text-sm text-gray-500 mt-1">{incident.summary}</p>
          )}
        </div>
        <div className="text-right text-sm shrink-0">
          <span
            className={cn(
              'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
              isResolved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
            )}
          >
            {isResolved ? 'Resolved' : 'Active'}
          </span>
          <div className="text-xs text-gray-400 mt-1">
            {formatRelative(incident.created_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.status === 404) {
        setError('Status page is not enabled. An administrator needs to enable it in Settings.');
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh
  useEffect(() => {
    if (!data) return;
    const interval = setInterval(fetchStatus, data.autoRefreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [data, fetchStatus]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <XCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const statusConf = STATUS_CONFIG[data.overallStatus];
  const StatusIcon = statusConf.icon;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{data.title}</h1>
          {data.description && (
            <p className="text-gray-500 mt-1">{data.description}</p>
          )}
        </div>

        {/* Overall Status Banner */}
        <div className={cn('border rounded-xl p-6 mb-8 text-center', statusConf.bg)}>
          <StatusIcon className={cn('h-8 w-8 mx-auto mb-2', statusConf.color)} />
          <h2 className={cn('text-lg font-semibold', statusConf.color)}>
            {statusConf.label}
          </h2>
        </div>

        {/* Uptime Summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            Uptime
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {(['24h', '7d', '30d'] as const).map((period) => (
              <div key={period} className="text-center">
                <div className={cn('text-2xl font-bold', uptimeTooltipColor(data.uptime[period]))}>
                  {data.uptime[period]}%
                </div>
                <div className="text-xs text-gray-400 uppercase mt-1">{period}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Current Snapshot */}
        {data.snapshot && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
              Current Status
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                <Container className="h-4 w-4 text-emerald-500" />
                <div>
                  <div className="text-lg font-semibold">{data.snapshot.containersRunning}</div>
                  <div className="text-xs text-gray-400">Running</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Container className="h-4 w-4 text-gray-400" />
                <div>
                  <div className="text-lg font-semibold">{data.snapshot.containersStopped}</div>
                  <div className="text-xs text-gray-400">Stopped</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-yellow-500" />
                <div>
                  <div className="text-lg font-semibold">{data.snapshot.containersUnhealthy}</div>
                  <div className="text-xs text-gray-400">Unhealthy</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-blue-500" />
                <div>
                  <div className="text-lg font-semibold">{data.snapshot.endpointsUp}</div>
                  <div className="text-xs text-gray-400">Endpoints Up</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 90-day Uptime Timeline */}
        {data.uptimeTimeline.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
              Uptime History (90 days)
            </h3>
            <UptimeTimeline buckets={data.uptimeTimeline} />
          </div>
        )}

        {/* Recent Incidents */}
        {data.recentIncidents && data.recentIncidents.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
              Recent Incidents
            </h3>
            <div className="space-y-3">
              {data.recentIncidents.map((incident) => (
                <IncidentItem key={incident.id} incident={incident} />
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400 mt-8 pb-4">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>Last updated: {formatTime(lastRefresh.toISOString())}</span>
          </div>
          <button
            onClick={fetchStatus}
            className="flex items-center gap-1 hover:text-gray-600 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Refresh</span>
          </button>
        </div>
      </div>
    </div>
  );
}
