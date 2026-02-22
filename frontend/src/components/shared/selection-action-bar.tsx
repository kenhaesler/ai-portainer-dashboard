import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

interface SelectionActionBarProps {
  selectedCount: number;
  children: React.ReactNode;
  onClear: () => void;
  visible: boolean;
}

export function SelectionActionBar({
  selectedCount,
  children,
  onClear,
  visible,
}: SelectionActionBarProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid="selection-action-bar"
          initial={reduceMotion ? false : { y: 80, opacity: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: 80, opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0.15 }
              : { type: 'spring', damping: 25, stiffness: 300 }
          }
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border bg-card/80 px-4 py-3 shadow-lg backdrop-blur-xl max-sm:left-4 max-sm:right-4 max-sm:bottom-4 max-sm:translate-x-0 max-sm:justify-between"
        >
          {/* Selection count badge */}
          <span
            data-testid="selection-count"
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground"
          >
            {selectedCount}
          </span>
          <span className="text-sm font-medium text-muted-foreground">selected</span>

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-border" />

          {/* Action buttons slot */}
          {children}

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-border" />

          {/* Clear button */}
          <button
            data-testid="clear-selection"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
            Clear
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
