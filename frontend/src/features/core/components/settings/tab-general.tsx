import { Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useCacheStats, useCacheClear } from '@/hooks/use-cache-admin';

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
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium">Key</th>
                        <th className="p-3 text-right font-medium">Expires In (TTL)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cacheStats.entries.map((entry) => (
                        <tr key={entry.key} className="border-b last:border-0">
                          <td className="p-3 font-mono text-xs">{entry.key}</td>
                          <td className="p-3 text-right text-muted-foreground">{entry.expiresIn}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
