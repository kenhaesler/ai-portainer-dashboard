import { useState, useMemo } from 'react';
import { HardDrive, Layers, Tag, AlertTriangle, X, Server } from 'lucide-react';
import { useImages, type DockerImage } from '@/hooks/use-images';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { ImageTreemap } from '@/components/charts/image-treemap';
import { ImageSunburst } from '@/components/charts/image-sunburst';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function ImageFootprintPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>(undefined);
  const [selectedImage, setSelectedImage] = useState<DockerImage | null>(null);

  const { data: endpoints } = useEndpoints();
  const { data: images, isLoading, isError, error, refetch, isFetching } = useImages(selectedEndpoint);
  const { interval, setInterval } = useAutoRefresh(60);

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
      <div className="space-y-6">
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Image Footprint</h1>
          <p className="text-muted-foreground">
            Analyze Docker image sizes and layer composition
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Filters and Summary */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <select
            value={selectedEndpoint ?? ''}
            onChange={(e) => setSelectedEndpoint(e.target.value ? Number(e.target.value) : undefined)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Endpoints</option>
            {endpoints?.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name}
              </option>
            ))}
          </select>
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

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SkeletonCard className="h-[500px]" />
          <SkeletonCard className="h-[500px]" />
        </div>
      ) : images && images.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Treemap */}
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Image Size Distribution</h2>
            <p className="mb-4 text-sm text-muted-foreground">
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

          {/* Sunburst */}
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Registry Distribution</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Inner ring shows registry distribution, outer ring shows individual images.
            </p>
            <ImageSunburst data={sunburstData} />
          </div>
        </div>
      ) : images && images.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <Layers className="mx-auto h-10 w-10 opacity-50" />
          <p className="mt-4">No images found</p>
          <p className="mt-1 text-sm">
            {selectedEndpoint
              ? 'This endpoint has no Docker images.'
              : 'No Docker images found across any endpoints.'}
          </p>
        </div>
      ) : null}

      {/* Image List Table */}
      {!isLoading && images && images.length > 0 && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">All Images</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="pb-3 font-medium">Image</th>
                  <th className="pb-3 font-medium">Tags</th>
                  <th className="pb-3 font-medium">Size</th>
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
                      <td className="py-3">
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
      )}

      {/* Detail Sidebar */}
      {selectedImage && (
        <div className="fixed inset-y-0 right-0 z-50 w-96 overflow-y-auto border-l bg-background p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Image Details</h2>
            <button
              onClick={() => setSelectedImage(null)}
              className="rounded-md p-1 hover:bg-accent"
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
              <p className="mt-1 break-all font-mono text-sm">{selectedImage.id}</p>
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
                      className="flex items-center gap-2 rounded-md border bg-secondary/50 px-3 py-2"
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

      {/* Backdrop for sidebar */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setSelectedImage(null)}
        />
      )}
    </div>
  );
}
