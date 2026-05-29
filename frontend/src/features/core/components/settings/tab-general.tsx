import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { DataTable } from '@/shared/components/tables/data-table';
import { useCacheStats, useCacheClear } from '@/features/core/hooks/use-cache-admin';

interface CacheEntryRow {
  key: string;
  expiresIn: number;
}

export interface CacheStatsSummary {
  backend: 'multi-layer' | 'memory-only';
  l1Size: number;
  l2Size: number;
}

export function getRedisSystemInfo(cacheStats?: CacheStatsSummary) {
  if (!cacheStats) {
    return {
      status: 'Unknown',
      details: 'Cache stats unavailable',
      keys: 'N/A',
    };
  }

  const redisEnabled = cacheStats.backend === 'multi-layer';
  return {
    status: redisEnabled ? 'Active' : 'Inactive (Memory fallback)',
    details: redisEnabled
      ? 'Using Redis + in-memory cache'
      : 'Using in-memory cache only',
    keys: redisEnabled ? String(cacheStats.l2Size) : 'N/A',
  };
}

interface GeneralTabProps {
  theme: string;
}

export function GeneralTab({ theme }: GeneralTabProps) {
  const { data: cacheStats } = useCacheStats();
  const cacheClear = useCacheClear();
  const redisSystemInfo = getRedisSystemInfo(cacheStats);

  const cacheEntryColumns = useMemo<ColumnDef<CacheEntryRow, unknown>[]>(
    () => [
      {
        accessorKey: 'key',
        header: 'Key',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'expiresIn',
        header: () => <span className="block text-right">Expires In (TTL)</span>,
        cell: ({ getValue }) => (
          <span className="block text-right text-muted-foreground">{getValue<number>()}s</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {/* System Info */}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            <h2 className="text-lg font-semibold">System Information</h2>
          </div>
          <button
            onClick={() => cacheClear.mutate()}
            disabled={cacheClear.isPending}
            className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {cacheClear.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Clear All Cache
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Application</p>
            <p className="font-medium mt-1">Docker Insight</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Version</p>
            <p className="font-medium mt-1">1.0.0</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Mode</p>
            <p className="font-medium mt-1">Observer Only</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Theme</p>
            <p className="font-medium mt-1 capitalize">{theme.replace('-', ' ')}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Redis Cache</p>
            <p className="font-medium mt-1">{redisSystemInfo.status}</p>
            <p className="text-xs text-muted-foreground mt-1">{redisSystemInfo.details}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 md:col-span-2 lg:col-span-3">
            <h3 className="text-sm font-semibold">Cache Info</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Entries</p>
                <p className="font-medium mt-1">{cacheStats?.size ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Hits</p>
                <p className="font-medium mt-1">{cacheStats?.hits ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Misses</p>
                <p className="font-medium mt-1">{cacheStats?.misses ?? 0}</p>
              </div>
              <div className="rounded-md border border-border/40 bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">Hit Rate</p>
                <p className="font-medium mt-1">{cacheStats?.hitRate ?? 'N/A'}</p>
              </div>
            </div>
            {cacheStats?.entries && cacheStats.entries.length > 0 && (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                  <p className="text-xs font-medium">Redis Keys</p>
                  <p className="mt-1 text-lg font-semibold">{redisSystemInfo.keys}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Count of keys currently stored in Redis (L2 cache). More keys means more reusable cached responses.
                  </p>
                </div>
                <div className="rounded-lg border border-border/50 bg-muted/20">
                  <div className="border-b border-border/50 px-3 py-2">
                    <p className="text-xs font-medium">Cached Entry Keys</p>
                    <p className="text-xs text-muted-foreground">
                      Internal cache identifiers used by the backend for stored query results.
                    </p>
                  </div>
                  <div className="p-3">
                    <DataTable
                      columns={cacheEntryColumns}
                      data={cacheStats.entries}
                      getRowId={(entry) => entry.key}
                      hideSearch
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Caching model — informational, not a toggle. See #1312. */}
      <div
        data-testid="caching-model-note"
        className="rounded-lg border border-border/60 bg-muted/30 p-4"
      >
        <h3 className="text-sm font-semibold">About data freshness</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Auto-refresh and background polls read from the server cache to reduce load on Portainer.
          Clicking <strong className="font-medium text-foreground">Refresh</strong> on any page
          invalidates the cache for that resource and fetches fresh data from Portainer directly.
          Cache invalidation requires admin permissions; non-admin clicks fall back to a plain
          refresh.
        </p>
      </div>
    </div>
  );
}
