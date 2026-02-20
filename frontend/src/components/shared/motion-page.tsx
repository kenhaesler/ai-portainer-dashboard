import { motion, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { pageVariants, transition, easing, duration } from '@/lib/motion-tokens';

// Module-level set tracking visited paths — persists across renders but
// resets on full page reload (which is fine: users expect entrance animation
// after a hard refresh).
const visitedPaths = new Set<string>();

/** Returns true if this path has been visited before in this session.
 *  Safe to call outside a Router context (e.g. status page, storybook) —
 *  useLocation() always calls useContext internally (maintaining hooks order)
 *  before throwing, so the try-catch is React-safe. */
function useIsReturnVisit(): boolean {
  let pathname: string;
  try {
    pathname = useLocation().pathname;
  } catch {
    // No Router context — skip the optimisation
    return false;
  }
  if (visitedPaths.has(pathname)) return true;
  visitedPaths.add(pathname);
  return false;
}

/** Exported for testing — allows tests to reset state between runs. */
export function _resetVisitedPaths() {
  visitedPaths.clear();
}

export function MotionPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const isReturn = useIsReturnVisit();
  const skipAnimation = reducedMotion || isReturn;

  return (
    <motion.div
      className={cn('space-y-6', className)}
      variants={pageVariants}
      initial={skipAnimation ? false : 'initial'}
      animate="animate"
      exit="exit"
      transition={skipAnimation ? { duration: 0 } : transition.page}
    >
      {children}
    </motion.div>
  );
}

export function MotionStagger({
  children,
  className,
  stagger = 0.05,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
}) {
  const reducedMotion = useReducedMotion();
  const isReturn = useIsReturnVisit();
  const skipAnimation = reducedMotion || isReturn;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 1 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: skipAnimation ? 0 : stagger, delayChildren: skipAnimation ? 0 : 0.04 },
        },
      }}
      initial={skipAnimation ? false : 'hidden'}
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

export function MotionReveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const isReturn = useIsReturnVisit();
  const skipAnimation = reducedMotion || isReturn;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: skipAnimation ? 1 : 0, y: skipAnimation ? 0 : 8, scale: skipAnimation ? 1 : 0.99 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: skipAnimation ? 0 : duration.fast, ease: [...easing.pop] },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
