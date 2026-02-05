import { Star } from 'lucide-react';
import { useFavoritesStore } from '@/stores/favorites-store';

interface FavoriteButtonProps {
  endpointId: number;
  containerId: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function FavoriteButton({ endpointId, containerId, className = '', size = 'md' }: FavoriteButtonProps) {
  const isFavorite = useFavoritesStore(
    (s) => s.favoriteIds.includes(`${endpointId}:${containerId}`),
  );
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleFavorite(endpointId, containerId);
      }}
      className={`inline-flex items-center justify-center rounded-md transition-colors hover:bg-accent ${className}`}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Star
        className={`${iconSize} ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`}
      />
    </button>
  );
}
