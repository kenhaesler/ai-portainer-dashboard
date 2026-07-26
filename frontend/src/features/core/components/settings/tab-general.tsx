import { version as reactVersion } from 'react';
import { ChevronRight, Settings2 } from 'lucide-react';
import { useCacheStats } from '@/features/core/hooks/use-cache-admin';
import { useSystemInfo } from '@/features/core/hooks/use-system-info';
import { PRODUCT_NAME } from '@/shared/lib/product';

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
  const { data: systemInfo } = useSystemInfo();
  const redisSystemInfo = getRedisSystemInfo(cacheStats);

  return (
    <div className="space-y-6">
      {/* System Info — a disclosure, because nobody opens Settings to read a
          version string. Cache administration lives with the cache settings on
          the Infrastructure tab. */}
      <details data-testid="system-information" className="group rounded-lg border bg-card p-6" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
          <Settings2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">System Information</h2>
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Application</p>
            <p className="font-medium mt-1">{PRODUCT_NAME}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Version</p>
            <p className="font-medium mt-1">{systemInfo?.app ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Mode</p>
            <p className="font-medium mt-1">Observer Only</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Node.js</p>
            <p className="font-medium mt-1">{systemInfo?.node ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Fastify</p>
            <p className="font-medium mt-1">{systemInfo?.fastify ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">React</p>
            <p className="font-medium mt-1">{reactVersion}</p>
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
            {/* The per-key table that used to live here was `redis-cli KEYS`
                shipped as product surface — its own label conceded the reader
                had no use for it. The count is the part that reads. */}
            {cacheStats?.entries && cacheStats.entries.length > 0 && (
              <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3">
                <p className="text-xs font-medium">Redis Keys</p>
                <p className="mt-1 text-lg font-semibold">{redisSystemInfo.keys}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Count of keys currently stored in Redis (L2 cache). More keys means more reusable cached responses.
                </p>
              </div>
            )}
          </div>
        </div>
      </details>

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
