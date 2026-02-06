import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function MotionPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={cn('space-y-6', className)}
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
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

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 1 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: reducedMotion ? 0 : stagger, delayChildren: reducedMotion ? 0 : 0.04 },
        },
      }}
      initial={reducedMotion ? false : 'hidden'}
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

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 8, scale: reducedMotion ? 1 : 0.99 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: reducedMotion ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
