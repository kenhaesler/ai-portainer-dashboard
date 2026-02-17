import { useState, useMemo } from 'react';
import { HardDrive, Layers, Tag, AlertTriangle, X, Server, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { ThemedSelect } from '@/components/shared/themed-select';
import { useImages, type DockerImage } from '@/hooks/use-images';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { useImageStaleness, useTriggerStalenessCheck } from '@/hooks/use-image-staleness';
import { ImageTreemap } from '@/components/charts/image-treemap';
import { ImageSunburst } from '@/components/charts/image-sunburst';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { MotionPage, MotionReveal, MotionStagger } from '@/components/shared/motion-page';
import { TiltCard } from '@/components/shared/tilt-card';
import { SpotlightCard } from '@/components/shared/spotlight-card';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function ImageFootprintPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>(undefined);
  const [selectedImage, setSelectedImage] = useState<DockerImage | null>(null);

  const { data: endpoints } = useEndpoints();
  const { data: images, isLoading, isError, error, refetch, isFetching } = useImages(selectedEndpoint);
  const { forceRefresh, isForceRefreshing } = useForceRefresh('images', refetch);
  const { interval, setInterval } = useAutoRefresh(60);
  const { data: stalenessData } = useImageStaleness();
  const triggerCheck = useTriggerStalenessCheck();

  // Build a lookup map: imageName -> staleness record
  const stalenessMap = useMemo(() => {
    const map = new Map<string, { isStale: boolean; lastChecked: string }>();
    if (!stalenessData?.records) return map;
    for (const rec of stalenessData.records) {
      map.set(rec.image_name, {
        isStale: rec.is_stale === 1,
        lastChecked: rec.last_checked_at,
      });
    }
    return map;
  }, [stalenessData]);

  const stats = useMemo(() => {
    if (!images) return { totalSize: 0, imageCount: 0, registryCount: 0 };

    const registries = new Set(images.map((img) => img.registry));
    const totalSize = images.reduce((sum, img) => sum + img.size, 0);

    return {
      totalSize,
      imageCount: images.length,
      registryCount: registries.size,
    };
  }, [images]);

  const treemapData = useMemo(() => {
    if (!images) return [];
    return images
      .filter((img) => img.size > 0)
      .map((img) => ({
        name: img.name,
        size: img.size,
      }))
      .sort((a, b) => b.size - a.size);
  }, [images]);

  const sunburstData = useMemo(() => {
    if (!images) return [];
    return images
      .filter((img) => img.size > 0)
      .map((img) => ({
        name: img.name,
        size: img.size,
        registry: img.registry,
      }));
  }, [images]);

  if (isError) {
    return (
      <MotionPage>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Image Footprint</h1>
          <p className="text-muted-foreground">
            Analyze Docker image sizes and layer composition
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load images</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      </MotionPage>
    );
  }

  return (
    <MotionPage>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Image Footprint</h1>
          <p className="text-muted-foreground">
            Analyze Docker image sizes and layer composition
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

      {/* Filters and Summary */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <ThemedSelect
            value={selectedEndpoint !== undefined ? String(selectedEndpoint) : '__all__'}
            onValueChange={(val) => setSelectedEndpoint(val === '__all__' ? undefined : Number(val))}
            options={[
              { value: '__all__', label: 'All Endpoints' },
              ...(endpoints?.map((ep) => ({
                value: String(ep.id),
                label: ep.name,
              })) ?? []),
            ]}
          />
        </div>

        {!isLoading && images && (
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-blue-500" />
              <span className="font-medium">{formatBytes(stats.totalSize)}</span>
              <span className="text-muted-foreground">total disk usage</span>
            </div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              <span className="font-medium">{stats.imageCount}</span>
              <span className="text-muted-foreground">images</span>
            </div>
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-purple-500" />
              <span className="font-medium">{stats.registryCount}</span>
              <span className="text-muted-foreground">registries</span>
            </div>
          </div>
        )}
      </div>

      {/* Staleness Summary */}
      {stalenessData && stalenessData.summary.total > 0 && (
        <MotionStagger className="grid grid-cols-1 gap-4 sm:grid-cols-4" stagger={0.05}>
          <MotionReveal>
            <TiltCard>
              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Layers className="h-4 w-4" />
                  <span>Checked</span>
                </div>
                <p className="mt-1 text-2xl font-bold">{stalenessData.summary.total}</p>
              </div>
            </TiltCard>
          </MotionReveal>
          <MotionReveal>
            <TiltCard>
              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Up to Date</span>
                </div>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{stalenessData.summary.upToDate}</p>
              </div>
            </TiltCard>
          </MotionReveal>
          <MotionReveal>
            <TiltCard>
              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Stale</span>
                </div>
                <p className="mt-1 text-2xl font-bold text-yellow-600">{stalenessData.summary.stale}</p>
              </div>
            </TiltCard>
          </MotionReveal>
          <MotionReveal>
            <TiltCard>
              <div className="flex items-center justify-center rounded-lg border bg-card p-4 shadow-sm">
                <button
                  onClick={() => triggerCheck.mutate()}
                  disabled={triggerCheck.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {triggerCheck.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {triggerCheck.isPending ? 'Checking...' : 'Check Now'}
                </button>
              </div>
            </TiltCard>
          </MotionReveal>
        </MotionStagger>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SkeletonCard className="h-[500px]" />
          <SkeletonCard className="h-[500px]" />
        </div>
      ) : images && images.length > 0 ? (
        <MotionStagger className="grid grid-cols-1 gap-6 lg:grid-cols-2" stagger={0.05}>
          {/* Treemap */}
          <MotionReveal>
            <SpotlightCard>
              <div className="rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                  Image Size Distribution
                </h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Visualizes relative image sizes. Larger boxes indicate larger images. Click an image to view details.
                </p>
                <div onClick={(e) => {
                  const target = e.target as HTMLElement;
                  const text = target.closest('g')?.querySelector('text')?.textContent;
                  if (text) {
                    const name = text.endsWith('...') ? text.slice(0, -3) : text;
                    const matchingImage = images.find((img) => img.name.startsWith(name));
                    if (matchingImage) {
                      setSelectedImage(matchingImage);
                    }
                  }
                }}>
                  <ImageTreemap data={treemapData} />
                </div>
              </div>
            </SpotlightCard>
          </MotionReveal>

          {/* Sunburst */}
          <MotionReveal>
            <SpotlightCard>
              <div className="rounded-lg border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-medium text-muted-foreground">
                  Registry Distribution
                </h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Inner ring shows registry distribution, outer ring shows individual images.
                </p>
                <ImageSunburst data={sunburstData} />
              </div>
            </SpotlightCard>
          </MotionReveal>
        </MotionStagger>
      ) : images && images.length === 0 ? (
        <MotionReveal>
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            <Layers className="mx-auto h-10 w-10 opacity-50" />
            <p className="mt-4">No images found</p>
            <p className="mt-1 text-sm">
              {selectedEndpoint
                ? 'This endpoint has no Docker images.'
                : 'No Docker images found across any endpoints.'}
            </p>
          </div>
        </MotionReveal>
      ) : null}

      {/* Image List Table */}
      {!isLoading && images && images.length > 0 && (
        <MotionReveal>
          <SpotlightCard>
            <div className="rounded-lg border bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-medium text-muted-foreground">All Images</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pl-2 pr-3 font-medium">Image</th>
                      <th className="pb-3 font-medium">Tags</th>
                      <th className="pb-3 font-medium">Size</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium">Registry</th>
                      {!selectedEndpoint && <th className="pb-3 font-medium">Endpoint</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {images
                      .sort((a, b) => b.size - a.size)
                      .map((image) => (
                        <tr
                          key={`${image.id}-${image.endpointId}`}
                          className={cn(
                            'cursor-pointer transition-colors hover:bg-accent/50',
                            selectedImage?.id === image.id && 'bg-accent'
                          )}
                          onClick={() => setSelectedImage(image)}
                        >
                          <td className="py-3 pl-2 pr-3">
                            <span className="font-medium">{image.name}</span>
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {image.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-xs"
                                >
                                  {tag.split(':')[1] || tag}
                                </span>
                              ))}
                              {image.tags.length > 3 && (
                                <span className="text-xs text-muted-foreground">
                                  +{image.tags.length - 3} more
                                </span>
                              )}
                              {image.tags.length === 0 && (
                                <span className="text-xs text-muted-foreground">No tags</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 font-mono text-sm">{formatBytes(image.size)}</td>
                          <td className="py-3">
                            {(() => {
                              const staleness = stalenessMap.get(image.name);
                              if (!staleness) return <span className="text-xs text-muted-foreground">Unchecked</span>;
                              return staleness.isStale ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                  <AlertTriangle className="h-3 w-3" /> Update Available
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3" /> Up to Date
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-3 text-sm text-muted-foreground">{image.registry}</td>
                          {!selectedEndpoint && (
                            <td className="py-3 text-sm text-muted-foreground">
                              {image.endpointName || `Endpoint ${image.endpointId}`}
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </SpotlightCard>
        </MotionReveal>
      )}

      {/* Backdrop for sidebar */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        />
      )}

      {/* Detail Sidebar — scoped to content area, not overlapping nav */}
      {selectedImage && (
        <div className="fixed top-4 right-4 bottom-4 z-50 w-96 overflow-y-auto rounded-2xl border border-border/50 bg-card/80 p-6 shadow-xl backdrop-blur-xl ring-1 ring-white/10 dark:ring-white/5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Image Details</h2>
            <button
              onClick={() => setSelectedImage(null)}
              className="rounded-lg p-1.5 transition-colors hover:bg-accent/80"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-6 space-y-6">
            {/* Image Name */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Image Name
              </label>
              <p className="mt-1 break-all font-medium">{selectedImage.name}</p>
            </div>

            {/* ID */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Image ID
              </label>
              <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{selectedImage.id}</p>
            </div>

            {/* Size */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Size
              </label>
              <p className="mt-1 text-2xl font-bold text-blue-500">
                {formatBytes(selectedImage.size)}
              </p>
            </div>

            {/* Registry */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Registry
              </label>
              <p className="mt-1">{selectedImage.registry}</p>
            </div>

            {/* Endpoint */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Endpoint
              </label>
              <p className="mt-1">
                {selectedImage.endpointName || `Endpoint ${selectedImage.endpointId}`}
              </p>
            </div>

            {/* Created */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Created
              </label>
              <p className="mt-1">
                {selectedImage.created
                  ? new Date(selectedImage.created * 1000).toLocaleString()
                  : 'Unknown'}
              </p>
            </div>

            {/* Tags */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Tags ({selectedImage.tags.length})
              </label>
              <div className="mt-2 space-y-2">
                {selectedImage.tags.length > 0 ? (
                  selectedImage.tags.map((tag) => (
                    <div
                      key={tag}
                      className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 backdrop-blur-sm"
                    >
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span className="break-all text-sm">{tag}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No tags available</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </MotionPage>
  );
}
