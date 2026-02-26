import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { spring } from '@/lib/motion-tokens';
import { cn } from '@/lib/utils';

interface ExpandableRowProps {
  /** Whether the row is currently expanded */
  expanded: boolean;
  /** Called when the trigger is clicked */
  onToggle: () => void;
  /** Content rendered inside the trigger button (left of the chevron) */
  trigger: React.ReactNode;
  /** Content revealed when expanded */
  children: React.ReactNode;
  className?: string;
}

export function ExpandableRow({
  expanded,
  onToggle,
  trigger,
  children,
  className,
}: ExpandableRowProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className={cn('border-b border-border/40', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={onToggle}
        data-testid="expandable-row-trigger"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/50"
      >
        <motion.span
          data-testid="expandable-row-chevron"
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={reducedMotion ? { duration: 0 } : spring.snappy}
        >
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </motion.span>
        {trigger}
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            data-testid="expandable-row-content"
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : spring.gentle}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
