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
  incident_ids: string[];
  incident_count: number;
  latest_at: string;
  latest_summary: string | null;
  latest_description: string | null;
}

const SEV_RANK: Record<LongTailRow['severity'], number> = { critical: 0, warning: 1, info: 2 };

function dedupeByContainer(
  incidents: Array<{
    id: string; affected_containers: string[];
    endpoint_id: number | null; endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info'; created_at: string;
    updated_at?: string; summary?: string | null;
  }>,
): LongTailRow[] {
  const byContainer = new Map<string, LongTailRow>();
  for (const inc of incidents) {
    for (const name of inc.affected_containers ?? []) {
      const existing = byContainer.get(name);
      const incLatest = inc.updated_at ?? inc.created_at;
      if (!existing) {
        byContainer.set(name, {
          incident_id: inc.id, container_name: name,
          endpoint_id: inc.endpoint_id, endpoint_name: inc.endpoint_name,
          severity: inc.severity, created_at: inc.created_at,
          incident_ids: [inc.id], incident_count: 1,
          latest_at: incLatest,
          latest_summary: inc.summary ?? null,
          latest_description: null, // long-tail fetch doesn't carry the joined insight description
        });
        continue;
      }
      existing.incident_ids.push(inc.id);
      existing.incident_count = existing.incident_ids.length;
      if (incLatest > existing.latest_at) existing.latest_at = incLatest;
      // Promote representative if this incident is more severe, or same severity but more recent.
      const sevCmp = SEV_RANK[inc.severity] - SEV_RANK[existing.severity];
      const isMoreRecent = inc.created_at > existing.created_at;
      if (sevCmp < 0 || (sevCmp === 0 && isMoreRecent)) {
        existing.incident_id = inc.id;
        existing.severity = inc.severity;
        existing.created_at = inc.created_at;
        existing.endpoint_id = inc.endpoint_id;
        existing.endpoint_name = inc.endpoint_name;
        existing.latest_summary = inc.summary ?? existing.latest_summary;
      }
    }
  }
  return Array.from(byContainer.values());
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

  // Stable join-key of truncated-group signatures — only changes when the SET of
  // groups that need a long-tail fetch actually changes, not on every 30s refetch.
  const truncatedSigs = useMemo(
    () => (data?.groups.filter((g) => g.names_truncated).map((g) => g.signature).sort().join('|')) ?? '',
    [data?.groups],
  );

  useEffect(() => {
    if (!searchLower || !truncatedSigs) return;
    const controller = new AbortController();
    for (const sig of truncatedSigs.split('|').filter(Boolean)) {
      api.get<{ incidents: Array<{ id: string; affected_containers: string[]; endpoint_id: number | null; endpoint_name: string | null; severity: 'critical' | 'warning' | 'info'; created_at: string; updated_at?: string; summary?: string | null }> }>(
        '/api/incidents',
        { params: { status: 'active', signature: sig, q: debouncedSearch }, signal: controller.signal },
      ).then((r) => {
        const rows = dedupeByContainer(r.incidents);
        setLongTailBySig((prev) => ({ ...prev, [sig]: rows }));
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [searchLower, debouncedSearch, truncatedSigs]);

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
    const ids = (longTail ?? group.top_containers).flatMap((c) => c.incident_ids);
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
    const controller = new AbortController();
    const r = await api.get<{
      incidents: Array<{
        id: string;
        affected_containers: string[];
        endpoint_id: number | null;
        endpoint_name: string | null;
        severity: 'critical' | 'warning' | 'info';
        created_at: string;
        updated_at?: string;
        summary?: string | null;
      }>;
    }>('/api/incidents', { params: { status: 'active', signature: group.signature, limit: '500' }, signal: controller.signal });
    const rows = dedupeByContainer(r.incidents);
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

      <EndpointChips facets={data.endpoint_facets} />

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
                  {rows.map((row) => {
                    const detail = ('latest_description' in row ? row.latest_description : null)
                      ?? ('latest_summary' in row ? row.latest_summary : null);
                    const count = ('incident_count' in row ? row.incident_count : 1) ?? 1;
                    return (
                      <li
                        key={`${row.incident_id}:${row.container_name}`}
                        className="flex flex-col gap-1 px-4 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Link
                              to={`/containers/${row.endpoint_id}/${row.container_name}`}
                              className="font-mono text-sm hover:underline truncate"
                            >
                              {row.container_name}
                            </Link>
                            {count > 1 && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {count} alerts
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {row.severity} · {row.endpoint_name ?? 'unknown'}
                          </span>
                        </div>
                        {detail && (
                          <p className="pl-1 text-xs text-muted-foreground">
                            {detail}
                          </p>
                        )}
                      </li>
                    );
                  })}
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

function EndpointChips({
  facets,
}: {
  facets: Array<{ endpoint_id: number | null; endpoint_name: string | null; incident_count: number }>;
}) {
  if (facets.length <= 1) return null;
  const inline = facets.slice(0, 8);
  const overflow = facets.slice(8);
  return (
    <div data-testid="endpoint-chip-row" className="flex flex-wrap items-center gap-2">
      {inline.map((f) => (
        <button key={`${f.endpoint_id ?? 'none'}`} type="button" className="rounded-full border px-3 py-1 text-xs">
          {f.endpoint_name ?? 'unknown'} ({f.incident_count})
        </button>
      ))}
      {overflow.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer rounded-full border px-3 py-1 text-xs">+{overflow.length} more</summary>
          <ul className="absolute z-10 mt-1 max-h-64 w-64 overflow-auto rounded-md border bg-popover p-1 shadow">
            {overflow.map((f) => (
              <li key={`${f.endpoint_id ?? 'none'}`}>
                <button type="button" className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted">
                  {f.endpoint_name ?? 'unknown'} ({f.incident_count})
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
