import { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'framer-motion';
import { HardDrive, Layers, Tag, AlertTriangle, X, Server, CheckCircle2, Copy, Check } from 'lucide-react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { useImages, type DockerImage } from '@/features/containers/hooks/use-images';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { useImageStaleness } from '@/features/containers/hooks/use-image-staleness';
import { ImageTreemap } from '@/shared/components/charts/image-treemap';
import { ImageSunburst } from '@/shared/components/charts/image-sunburst';
import { AutoRefreshToggle } from '@/shared/components/ui/auto-refresh-toggle';
import { RefreshButton } from '@/shared/components/ui/refresh-button';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { SkeletonCard } from '@/shared/components/feedback/loading-skeleton';
import { DataTable } from '@/shared/components/tables/data-table';
import { KpiCard } from '@/shared/components/data-display/kpi-card';
import { MotionPage, MotionReveal, MotionStagger } from '@/shared/components/layout/motion-page';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { spring } from '@/shared/lib/motion-tokens';
import { formatBytes, truncate } from '@/shared/lib/utils';

export default function ImageFootprintPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>(undefined);
  const [selectedImage, setSelectedImage] = useState<DockerImage | null>(null);

  const { data: endpoints } = useEndpoints();
  const { interval, setInterval, enabled } = useAutoRefresh(60);
  const { data: images, isLoading, isPending, isError, error, refetch, isFetching } = useImages(
    selectedEndpoint,
    { refetchInterval: enabled && interval > 0 ? interval * 1000 : false },
  );
  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const showSkeleton = isLoading || (isPending && !images);
  const { forceRefresh, isForceRefreshing } = useForceRefresh('images', refetch);
  const { data: stalenessData } = useImageStaleness();

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

  const sortedImages = useMemo(() => {
    if (!images) return [];
    return [...images].sort((a, b) => b.size - a.size);
  }, [images]);

  const imageColumns: ColumnDef<DockerImage, any>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Image',
      size: 280,
      cell: ({ row }) => {
        const image = row.original;
        return (
          <button
            onClick={() => setSelectedImage(image)}
            className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/20 hover:shadow-sm hover:ring-1 hover:ring-primary/20"
          >
            {truncate(image.name, 45)}
          </button>
        );
      },
    },
    {
      accessorKey: 'tags',
      header: 'Tags',
      cell: ({ row }) => {
        const tags = row.original.tags;
        return (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground"
              >
                {tag.split(':')[1] || tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-xs text-muted-foreground">+{tags.length - 3} more</span>
            )}
            {tags.length === 0 && (
              <span className="text-xs text-muted-foreground">No tags</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm">{formatBytes(getValue<number>())}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const staleness = stalenessMap.get(row.original.name);
        if (!staleness) return <span className="text-xs text-muted-foreground">Unchecked</span>;
        return staleness.isStale ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <AlertTriangle className="h-3 w-3" /> Update Available
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Up to Date
          </span>
        );
      },
    },
    {
      accessorKey: 'registry',
      header: 'Registry',
      cell: ({ getValue }) => (
        <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          {getValue<string>()}
        </span>
      ),
    },
    ...(!selectedEndpoint ? [{
      accessorKey: 'endpointName' as const,
      header: 'Endpoint',
      cell: ({ row }: { row: any }) => {
        const image = row.original as DockerImage;
        return (
          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
            {image.endpointName || `Endpoint ${image.endpointId}`}
          </span>
        );
      },
    } satisfies ColumnDef<DockerImage, any>] : []),
  ], [stalenessMap, selectedEndpoint]);

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

        {!showSkeleton && images && (
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
        <MotionStagger className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" stagger={0.05}>
          <MotionReveal className="h-full">
            <KpiCard
              label="Checked"
              value={stalenessData.summary.total}
              icon={<Layers className="h-5 w-5" />}
            />
          </MotionReveal>
          <MotionReveal className="h-full">
            <KpiCard
              label="Up to Date"
              value={stalenessData.summary.upToDate}
              icon={<CheckCircle2 className="h-5 w-5" />}
              trend="up"
              trendValue={`of ${stalenessData.summary.total} checked`}
            />
          </MotionReveal>
          <MotionReveal className="h-full">
            <KpiCard
              label="Stale"
              value={stalenessData.summary.stale}
              icon={<AlertTriangle className="h-5 w-5" />}
              trend={stalenessData.summary.stale > 0 ? 'down' : 'neutral'}
              trendValue={stalenessData.summary.stale > 0 ? `${stalenessData.summary.stale} outdated` : 'none'}
            />
          </MotionReveal>
        </MotionStagger>
      )}

      {/* Content */}
      {showSkeleton ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard className="h-[500px]" />
          <SkeletonCard className="h-[500px]" />
        </div>
      ) : images && images.length > 0 ? (
        <MotionStagger className="grid grid-cols-1 gap-4 lg:grid-cols-2" stagger={0.05}>
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
                  Shows total image size grouped by container registry.
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
      {!showSkeleton && images && images.length > 0 && (
        <MotionReveal>
          <SpotlightCard>
            <div className="rounded-lg border bg-card p-6 shadow-sm">
              <DataTable
                columns={imageColumns}
                data={sortedImages}
                searchKey="name"
                searchPlaceholder="Search images by name..."
                pageSize={15}
              />
            </div>
          </SpotlightCard>
        </MotionReveal>
      )}

      {/* Image Detail Slide Panel */}
      <AnimatePresence>
        {selectedImage && (
          <ImageDetailPanel
            image={selectedImage}
            stalenessMap={stalenessMap}
            onClose={() => setSelectedImage(null)}
          />
        )}
      </AnimatePresence>
    </MotionPage>
  );
}

/* ------------------------------------------------------------------ */
/*  Image Detail Slide Panel                                          */
/* ------------------------------------------------------------------ */


function ImageDetailPanel({
  image,
  stalenessMap,
  onClose,
}: {
  image: DockerImage;
  stalenessMap: Map<string, { isStale: boolean; lastChecked: string }>;
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const staleness = stalenessMap.get(image.name);

  return createPortal(
    <>
      {/* Backdrop */}
      <motion.div
        key="image-detail-backdrop"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in panel */}
      <motion.div
        key="image-detail-panel"
        role="dialog"
        aria-label={`Details for ${image.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border/50 bg-card/90 shadow-2xl backdrop-blur-[45px]"
        initial={{ x: '100%', opacity: 0.8 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0.6 }}
        transition={spring.snappy}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Image Details
            </p>
            <h2 className="mt-0.5 truncate text-lg font-semibold">{image.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Size hero */}
          <div className="border-b border-border/50 px-6 py-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Disk Usage
            </p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-primary">
              {formatBytes(image.size)}
            </p>
          </div>

          {/* Status + Registry row */}
          <div className="grid grid-cols-2 border-b border-border/50">
            <div className="border-r border-border/50 px-6 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <div className="mt-1.5">
                {staleness ? (
                  staleness.isStale ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                      <AlertTriangle className="h-3 w-3" />
                      Update Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Up to Date
                    </span>
                  )
                ) : (
                  <span className="text-sm text-muted-foreground">Unchecked</span>
                )}
              </div>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Registry
              </p>
              <p className="mt-1.5 text-sm font-medium">{image.registry}</p>
            </div>
          </div>

          {/* Metadata fields */}
          <div className="space-y-0 divide-y divide-border/50">
            {/* Image ID */}
            <div className="group px-6 py-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Image ID
                </p>
                <button
                  onClick={() => handleCopy(image.id, 'id')}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  title="Copy ID"
                >
                  {copiedField === 'id' ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {image.id}
              </p>
            </div>

            {/* Endpoint */}
            <div className="px-6 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Endpoint
              </p>
              <p className="mt-1 text-sm">
                {image.endpointName || `Endpoint ${image.endpointId}`}
              </p>
            </div>

            {/* Created */}
            <div className="px-6 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Created
              </p>
              <p className="mt-1 text-sm">
                {image.created
                  ? new Date(image.created * 1000).toLocaleString()
                  : 'Unknown'}
              </p>
            </div>

            {/* Last checked */}
            {staleness && (
              <div className="px-6 py-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last Checked
                </p>
                <p className="mt-1 text-sm">
                  {new Date(staleness.lastChecked).toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Tags section */}
          <div className="border-t border-border/50 px-6 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tags ({image.tags.length})
            </p>
            <div className="mt-3 space-y-1.5">
              {image.tags.length > 0 ? (
                image.tags.map((tag) => (
                  <div
                    key={tag}
                    className="group flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="break-all font-mono text-xs">{tag}</span>
                    </div>
                    <button
                      onClick={() => handleCopy(tag, tag)}
                      className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      title="Copy tag"
                    >
                      {copiedField === tag ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No tags available</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border/50 px-6 py-3">
          <p className="text-center text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> to close
          </p>
        </div>
      </motion.div>
    </>,
    document.body,
  );
}
