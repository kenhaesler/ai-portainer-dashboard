import { useMemo, useState, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { useIncidentGroups, type IncidentGroup } from '../hooks/use-incident-groups';
import { useBatchResolveIncidents, type BatchResolveResponse } from '../hooks/use-incidents';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface LongTailRow {
  incident_id: string;
  container_name: string;
  endpoint_id: number | null;
  endpoint_name: string | null;
  severity: 'critical' | 'warning' | 'info';
  created_at: string;
}

export function IncidentGroupsView({ search = '' }: { search?: string }) {
  const { data, isLoading } = useIncidentGroups({ status: 'active' });
  const [searchParams, setSearchParams] = useSearchParams();
  const expandParam = searchParams.get('expand') ?? '';

  const overrides = useMemo(() => {
    const opens = new Set<string>();
    const closes = new Set<string>();
    for (const part of expandParam.split(',').filter(Boolean)) {
      const decoded = decodeURIComponent(part);
      if (decoded.startsWith('-')) closes.add(decoded.slice(1));
      else opens.add(decoded);
    }
    return { opens, closes };
  }, [expandParam]);

  const [longTailBySig, setLongTailBySig] = useState<Record<string, LongTailRow[]>>({});
  const batchResolve = useBatchResolveIncidents();
  const [pendingGroup, setPendingGroup] = useState<IncidentGroup | null>(null);
  const [lastFailure, setLastFailure] = useState<BatchResolveResponse | null>(null);

  const summary = useMemo(() => computeSummary(data?.groups ?? []), [data?.groups]);

  const debouncedSearch = useDebounced(search, 250);
  const searchLower = debouncedSearch.toLowerCase();

  const visibleGroups = useMemo(() => {
    if (!data) return [];
    if (!searchLower) return data.groups;
    return data.groups.filter((g) =>
      g.label.toLowerCase().includes(searchLower) ||
      g.all_container_names.some((n) => n.toLowerCase().includes(searchLower)),
    );
  }, [data, searchLower]);

  useEffect(() => {
    if (!searchLower || !data) return;
    for (const g of data.groups) {
      if (!g.names_truncated) continue;
      api.get<{ incidents: Array<{ id: string; affected_containers: string[]; endpoint_id: number | null; endpoint_name: string | null; severity: 'critical' | 'warning' | 'info'; created_at: string }> }>(
        '/api/incidents', { params: { status: 'active', signature: g.signature, q: debouncedSearch } },
      ).then((r) => {
        const rows: LongTailRow[] = r.incidents.flatMap((inc) =>
          (inc.affected_containers ?? []).map((name) => ({
            incident_id: inc.id, container_name: name,
            endpoint_id: inc.endpoint_id, endpoint_name: inc.endpoint_name,
            severity: inc.severity, created_at: inc.created_at,
          })),
        );
        setLongTailBySig((prev) => ({ ...prev, [g.signature]: rows }));
      }).catch(() => undefined);
    }
  }, [searchLower, debouncedSearch, data]);

  const isOpen = useCallback((sig: string, severity: IncidentGroup['severity']) => {
    if (overrides.closes.has(sig)) return false;
    if (overrides.opens.has(sig)) return true;
    return severity === 'critical';
  }, [overrides]);

  const toggle = useCallback((sig: string, severity: IncidentGroup['severity']) => {
    const nowOpen = isOpen(sig, severity);
    const next = !nowOpen;
    const opens = new Set(overrides.opens);
    const closes = new Set(overrides.closes);
    opens.delete(sig);
    closes.delete(sig);
    const defaultOpen = severity === 'critical';
    // Only encode deviations from the default rule.
    if (next !== defaultOpen) {
      if (next) opens.add(sig); else closes.add(sig);
    }
    const parts = [
      ...Array.from(opens).map((s) => encodeURIComponent(s)),
      ...Array.from(closes).map((s) => '-' + encodeURIComponent(s)),
    ];
    const sp = new URLSearchParams(searchParams);
    if (parts.length > 0) sp.set('expand', parts.join(','));
    else sp.delete('expand');
    setSearchParams(sp, { replace: false });
  }, [searchParams, setSearchParams, overrides, isOpen]);

  const onResolveGroup = useCallback(async (group: IncidentGroup) => {
    setPendingGroup(null);
    const longTail = longTailBySig[group.signature];
    const ids = (longTail ?? group.top_containers).map((c) => c.incident_id);
    const r = await batchResolve.mutateAsync(ids);
    if (r.failed.length > 0) setLastFailure(r);
    else setLastFailure(null);
  }, [batchResolve, longTailBySig]);

  const onRetryFailed = useCallback(async () => {
    if (!lastFailure) return;
    const r = await batchResolve.mutateAsync(lastFailure.failed.map((f) => f.id));
    setLastFailure(r.failed.length > 0 ? r : null);
  }, [batchResolve, lastFailure]);

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

  if (data.groups.length === 0 || (searchLower && visibleGroups.length === 0)) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        {searchLower && visibleGroups.length === 0
          ? 'No incidents match the current search.'
          : 'No active incidents in this view.'}
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

      {visibleGroups.map((g) => {
        const effectivelyOpen = isOpen(g.signature, g.severity)
          || (!!searchLower && g.all_container_names.some((n) => n.toLowerCase().includes(searchLower)));
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
                {effectivelyOpen ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
              </div>
            </button>
            {effectivelyOpen && (
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
                {rows.length > 0 && (
                  <div className="border-t flex items-center justify-end gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => setPendingGroup(g)}
                      className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Resolve all {g.incident_count}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {pendingGroup && (
        <ConfirmDialog
          open={pendingGroup !== null}
          title={`Resolve all ${pendingGroup.incident_count} incidents in this group?`}
          description={`This will mark all ${pendingGroup.incident_count} active incident${pendingGroup.incident_count === 1 ? '' : 's'} in "${pendingGroup.label}" as resolved.`}
          onConfirm={() => void onResolveGroup(pendingGroup)}
          onCancel={() => setPendingGroup(null)}
          confirmLabel="Confirm"
          variant="warning"
        />
      )}
      {lastFailure && lastFailure.failed.length > 0 && (
        lastFailure.failed.length <= 5 ? (
          <div role="alert" className="rounded-md border border-red-500/40 bg-red-50/30 p-2 text-sm">
            <p className="font-medium">Retry {lastFailure.failed.length} failed</p>
            <ul className="mt-1 list-disc pl-5">
              {lastFailure.failed.map((f) => <li key={f.id}>{f.id}: {f.error}</li>)}
            </ul>
            <button onClick={() => void onRetryFailed()} className="mt-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white">Retry</button>
          </div>
        ) : (
          <div role="alert" className="rounded-md border border-red-500/40 bg-red-50/30 p-2 text-sm">
            <p className="font-medium">{lastFailure.failed.length} of {lastFailure.failed.length + lastFailure.resolved.length} resolves failed</p>
            <button onClick={() => void onRetryFailed()} className="mt-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white">Retry failed only</button>
          </div>
        )
      )}
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
