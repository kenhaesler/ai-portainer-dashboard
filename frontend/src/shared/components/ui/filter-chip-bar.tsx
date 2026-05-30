import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { transition } from '@/shared/lib/motion-tokens';

export interface FilterChip {
  key: string;
  label: string;
  value: string;
}

export interface FilterChipBarProps {
  filters: FilterChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

export function FilterChipBar({ filters, onRemove, onClearAll }: FilterChipBarProps) {
  const reduceMotion = useReducedMotion();

  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap" aria-live="polite" data-testid="filter-chip-bar">
      <AnimatePresence mode="popLayout">
        {filters.map((filter) => (
          <motion.span
            key={filter.key}
            layout
            initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            transition={reduceMotion ? { duration: 0 } : transition.fast}
            className="inline-flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur-sm border border-border/50 px-3 py-1 text-sm shadow-sm"
            data-testid={`filter-chip-${filter.key}`}
          >
            <span className="font-medium text-muted-foreground">{filter.label}:</span>
            <span>{filter.value}</span>
            <button
              type="button"
              onClick={() => onRemove(filter.key)}
              className="ml-1 -mr-1 rounded-full p-0.5 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${filter.label} filter`}
            >
              <X className="h-3 w-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      {filters.length >= 2 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          data-testid="filter-chip-clear-all"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
