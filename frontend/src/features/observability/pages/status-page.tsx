import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
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
import { cn } from '@/shared/lib/utils';
import { MotionStagger, MotionReveal } from '@/shared/components/motion-page';

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

const PARTICLES = [
  { left: '8%', delay: '0s', duration: '12s', size: '7px' },
  { left: '18%', delay: '0.8s', duration: '15s', size: '9px' },
  { left: '28%', delay: '0.4s', duration: '13s', size: '6px' },
  { left: '39%', delay: '1.2s', duration: '14s', size: '8px' },
  { left: '48%', delay: '0.2s', duration: '16s', size: '7px' },
  { left: '57%', delay: '1.5s', duration: '12s', size: '8px' },
  { left: '66%', delay: '0.6s', duration: '17s', size: '9px' },
  { left: '75%', delay: '1.1s', duration: '11s', size: '6px' },
  { left: '84%', delay: '0.9s', duration: '15s', size: '8px' },
  { left: '92%', delay: '0.3s', duration: '13s', size: '7px' },
];

const GLASS_CARD =
  'rounded-xl border bg-card/80 backdrop-blur-xl shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5';

const STATUS_CONFIG = {
  operational: {
    label: 'All Systems Operational',
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    iconBg: 'bg-emerald-500/15',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Partial System Degradation',
    color: 'text-yellow-600',
    bg: 'bg-yellow-500/10 border-yellow-500/30',
    iconBg: 'bg-yellow-500/15',
    icon: AlertTriangle,
  },
  major_outage: {
    label: 'Major Outage',
    color: 'text-red-600',
    bg: 'bg-red-500/10 border-red-500/30',
    iconBg: 'bg-red-500/15',
    icon: XCircle,
  },
} as const;

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  return reducedMotion;
}

function uptimeBarColor(pct: number): string {
  if (pct >= 99.9) return 'bg-emerald-500';
  if (pct >= 99) return 'bg-emerald-400';
  if (pct >= 95) return 'bg-yellow-400';
  if (pct >= 90) return 'bg-orange-400';
  return 'bg-red-500';
}

function uptimeTextColor(pct: number): string {
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

function UptimeTimeline({ buckets, reducedMotion }: { buckets: UptimeBucket[]; reducedMotion: boolean }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const last90 = buckets.slice(-90);

  return (
    <div className="relative">
      <div className="flex gap-[2px]" data-testid="uptime-timeline">
        {last90.map((bucket, i) => (
          <div
            key={bucket.date}
            className={cn(
              'flex-1 h-10 rounded-sm cursor-pointer min-w-[2px]',
              reducedMotion
                ? ''
                : 'transition-transform duration-150',
              uptimeBarColor(bucket.uptime_pct),
              hovered === i
                ? 'scale-y-125 ring-2 ring-offset-1 ring-foreground/20'
                : reducedMotion
                  ? ''
                  : 'hover:scale-y-110',
            )}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            title={`${bucket.date}: ${bucket.uptime_pct}%`}
          />
        ))}
      </div>
      {hovered !== null && last90[hovered] && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-lg border border-border rounded-lg shadow-xl px-3 py-2 text-sm z-10 whitespace-nowrap">
          <span className="font-medium text-foreground">{last90[hovered].date}</span>
          <span className={cn('ml-2 font-semibold', uptimeTextColor(last90[hovered].uptime_pct))}>
            {last90[hovered].uptime_pct}%
          </span>
        </div>
      )}
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{last90.length > 0 ? last90[0].date : ''}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function IncidentItem({ incident }: { incident: Incident }) {
  const isResolved = incident.status === 'resolved';

  return (
    <div className={cn(GLASS_CARD, 'p-4')}>
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
            <span className="font-medium text-foreground">{incident.title}</span>
          </div>
          {incident.summary && (
            <p className="text-sm text-muted-foreground mt-1">{incident.summary}</p>
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
          <div className="text-xs text-muted-foreground mt-1">
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
  const reducedMotion = usePrefersReducedMotion();

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

  useEffect(() => {
    if (!data) return;
    const interval = setInterval(fetchStatus, data.autoRefreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [data, fetchStatus]);

  if (loading) {
    return (
      <div className="relative min-h-screen bg-background flex items-center justify-center overflow-hidden">
        <div
          className={`login-gradient-mesh ${reducedMotion ? '' : 'login-gradient-mesh-animate'}`}
          aria-hidden="true"
        />
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground z-10" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative min-h-screen bg-background flex items-center justify-center overflow-hidden">
        <div
          className={`login-gradient-mesh ${reducedMotion ? '' : 'login-gradient-mesh-animate'}`}
          aria-hidden="true"
        />
        <div className="text-center z-10">
          <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const statusConf = STATUS_CONFIG[data.overallStatus];
  const StatusIcon = statusConf.icon;

  return (
    <div
      className="relative min-h-screen bg-background overflow-hidden"
      data-reduced-motion={reducedMotion}
    >
      {/* Gradient mesh background */}
      <div
        className={`login-gradient-mesh ${reducedMotion ? '' : 'login-gradient-mesh-animate'}`}
        aria-hidden="true"
        data-testid="status-gradient"
      />

      {/* Floating particles */}
      {!reducedMotion && (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          {PARTICLES.map((particle) => (
            <span
              key={`${particle.left}-${particle.delay}`}
              className="login-particle"
              style={
                {
                  left: particle.left,
                  width: particle.size,
                  height: particle.size,
                  animationDelay: particle.delay,
                  animationDuration: particle.duration,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-8">
        <MotionStagger className="space-y-6">
          {/* Header */}
          <MotionReveal>
            <div className="text-center mb-2">
              <h1 className="text-2xl font-bold text-foreground">{data.title}</h1>
              {data.description && (
                <p className="text-muted-foreground mt-1">{data.description}</p>
              )}
            </div>
          </MotionReveal>

          {/* Overall Status Banner */}
          <MotionReveal>
            <div
              className={cn(
                'rounded-xl border p-8 text-center backdrop-blur-xl',
                statusConf.bg,
              )}
              data-testid="status-banner"
            >
              <div className={cn('inline-flex items-center justify-center w-14 h-14 rounded-full mb-3', statusConf.iconBg)}>
                <StatusIcon className={cn('h-8 w-8', statusConf.color)} />
              </div>
              <h2 className={cn('text-lg font-semibold', statusConf.color)}>
                {statusConf.label}
              </h2>
            </div>
          </MotionReveal>

          {/* Uptime Summary — 3 side-by-side glass cards */}
          <MotionReveal>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Uptime
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {(['24h', '7d', '30d'] as const).map((period) => (
                  <div key={period} className={cn(GLASS_CARD, 'p-4 text-center')}>
                    <div className={cn('text-2xl font-bold', uptimeTextColor(data.uptime[period]))}>
                      {data.uptime[period]}%
                    </div>
                    <div className="text-xs text-muted-foreground uppercase mt-1">{period}</div>
                  </div>
                ))}
              </div>
            </div>
          </MotionReveal>

          {/* Current Snapshot */}
          {data.snapshot && (
            <MotionReveal>
              <div className={cn(GLASS_CARD, 'p-6')}>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
                  Current Status
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15">
                      <Container className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-foreground">{data.snapshot.containersRunning}</div>
                      <div className="text-xs text-muted-foreground">Running</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50">
                      <Container className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-foreground">{data.snapshot.containersStopped}</div>
                      <div className="text-xs text-muted-foreground">Stopped</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-yellow-500/15">
                      <Activity className="h-4 w-4 text-yellow-500" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-foreground">{data.snapshot.containersUnhealthy}</div>
                      <div className="text-xs text-muted-foreground">Unhealthy</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/15">
                      <Server className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-foreground">{data.snapshot.endpointsUp}</div>
                      <div className="text-xs text-muted-foreground">Endpoints Up</div>
                    </div>
                  </div>
                </div>
              </div>
            </MotionReveal>
          )}

          {/* 90-day Uptime Timeline */}
          {data.uptimeTimeline.length > 0 && (
            <MotionReveal>
              <div className={cn(GLASS_CARD, 'p-6')}>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
                  Uptime History (90 days)
                </h3>
                <UptimeTimeline buckets={data.uptimeTimeline} reducedMotion={reducedMotion} />
              </div>
            </MotionReveal>
          )}

          {/* Recent Incidents */}
          {data.recentIncidents && data.recentIncidents.length > 0 && (
            <MotionReveal>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Recent Incidents
                </h3>
                <div className="space-y-3">
                  {data.recentIncidents.map((incident) => (
                    <IncidentItem key={incident.id} incident={incident} />
                  ))}
                </div>
              </div>
            </MotionReveal>
          )}

          {/* Footer */}
          <MotionReveal>
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-4 pb-4">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>Last updated: {formatTime(lastRefresh.toISOString())}</span>
              </div>
              <button
                onClick={fetchStatus}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
              </button>
            </div>
          </MotionReveal>
        </MotionStagger>
      </div>
    </div>
  );
}
