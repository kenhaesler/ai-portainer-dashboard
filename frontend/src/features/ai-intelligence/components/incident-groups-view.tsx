import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { useIncidentGroups, type IncidentGroup } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';

interface LongTailRow {
  incident_id: string;
  container_name: string;
  endpoint_id: number | null;
  endpoint_name: string | null;
  severity: 'critical' | 'warning' | 'info';
  created_at: string;
}

export function IncidentGroupsView() {
  const { data, isLoading } = useIncidentGroups({ status: 'active' });
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [longTailBySig, setLongTailBySig] = useState<Record<string, LongTailRow[]>>({});

  const summary = useMemo(() => computeSummary(data?.groups ?? []), [data?.groups]);

  const isOpen = useCallback((sig: string, severity: IncidentGroup['severity']) => {
    if (sig in expandedOverrides) return expandedOverrides[sig];
    return severity === 'critical';
  }, [expandedOverrides]);

  const toggle = useCallback((sig: string, severity: IncidentGroup['severity']) => {
    setExpandedOverrides((prev) => ({ ...prev, [sig]: !isOpen(sig, severity) }));
  }, [isOpen]);

  const showAll = useCallback(async (group: IncidentGroup) => {
    const r = await api.get<{
      incidents: Array<{
        id: string;
        affected_containers: string[];
        endpoint_id: number | null;
        endpoint_name: string | null;
        severity: 'critical' | 'warning' | 'info';
        created_at: string;
      }>;
    }>('/api/incidents', { params: { status: 'active', signature: group.signature, limit: '500' } });
    const rows: LongTailRow[] = r.incidents.flatMap((inc) =>
      (inc.affected_containers ?? []).map((name) => ({
        incident_id: inc.id, container_name: name,
        endpoint_id: inc.endpoint_id, endpoint_name: inc.endpoint_name,
        severity: inc.severity, created_at: inc.created_at,
      })),
    );
    setLongTailBySig((prev) => ({ ...prev, [group.signature]: rows }));
  }, []);

  if (isLoading || !data) return null;

  if (data.groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No active incidents in this view.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div data-testid="summary-strip" className="text-sm">
        {summary.critical.containers > 0 && (
          <span>
            Critical: {summary.critical.kinds} kinds across {summary.critical.containers} container{summary.critical.containers === 1 ? '' : 's'}
          </span>
        )}
        {summary.warning.containers > 0 && (
          <span>
            {summary.critical.containers > 0 && ' · '}
            Warning: {summary.warning.kinds} kinds across {summary.warning.containers} container{summary.warning.containers === 1 ? '' : 's'}
          </span>
        )}
        {summary.info.containers > 0 && (
          <span>
            {(summary.critical.containers > 0 || summary.warning.containers > 0) && ' · '}
            Info: {summary.info.kinds} kinds across {summary.info.containers} container{summary.info.containers === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {data.groups.map((g) => {
        const open = isOpen(g.signature, g.severity);
        const longTail = longTailBySig[g.signature];
        const rows = longTail ?? g.top_containers;
        return (
          <div
            key={g.signature}
            className={cn(
              'overflow-hidden rounded-lg border-2 bg-card',
              g.severity === 'critical' ? 'border-red-500/40' : g.severity === 'warning' ? 'border-amber-500/40' : 'border-blue-500/40',
            )}
          >
            <button
              type="button"
              onClick={() => toggle(g.signature, g.severity)}
              className="w-full p-4 text-left transition-colors hover:bg-muted/20"
              aria-label={g.label}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      g.severity === 'critical' ? 'bg-red-500' : g.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500',
                    )}
                  />
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{g.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {g.container_count} container{g.container_count === 1 ? '' : 's'} · {g.alert_count} alert{g.alert_count === 1 ? '' : 's'}
                  </span>
                </div>
                {open ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
              </div>
            </button>
            {open && (
              <div className="border-t bg-muted/10">
                <ul className="divide-y">
                  {rows.map((row) => (
                    <li key={`${row.incident_id}:${row.container_name}`} className="flex items-center justify-between px-4 py-2 text-sm">
                      <Link
                        to={`/containers/${row.endpoint_id}/${row.container_name}`}
                        className="font-mono text-sm hover:underline"
                      >
                        {row.container_name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {row.severity} · {row.endpoint_name ?? 'unknown'}
                      </span>
                    </li>
                  ))}
                </ul>
                {!longTail && g.container_count > g.top_containers.length && (
                  <button
                    type="button"
                    onClick={() => showAll(g)}
                    className="block w-full px-4 py-2 text-center text-sm text-primary hover:bg-muted/30"
                  >
                    Show all {g.container_count}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function computeSummary(groups: IncidentGroup[]): {
  critical: { kinds: number; containers: number };
  warning: { kinds: number; containers: number };
  info: { kinds: number; containers: number };
} {
  // For each container, find its highest severity across all groups it appears in.
  const containerHighest = new Map<string, IncidentGroup['severity']>();
  for (const g of groups) {
    for (const name of g.all_container_names) {
      const cur = containerHighest.get(name);
      if (!cur || rankSeverity(g.severity) < rankSeverity(cur)) {
        containerHighest.set(name, g.severity);
      }
    }
  }
  const out = {
    critical: { kinds: 0, containers: 0 },
    warning: { kinds: 0, containers: 0 },
    info: { kinds: 0, containers: 0 },
  };
  for (const g of groups) out[g.severity].kinds++;
  for (const sev of containerHighest.values()) out[sev].containers++;
  return out;
}

function rankSeverity(s: IncidentGroup['severity']): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
}
