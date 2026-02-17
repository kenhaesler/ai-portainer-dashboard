import { useRef, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

const springConfig = { stiffness: 300, damping: 30 };

export function TiltCard({ children, className, disabled }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const potatoMode = useUiStore((state) => state.potatoMode);
  const isTiltDisabled = disabled || reducedMotion || potatoMode;

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  const springRotateX = useSpring(rotateX, springConfig);
  const springRotateY = useSpring(rotateY, springConfig);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isTiltDisabled || !ref.current) return;

      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Normalize mouse position to -1..1 range
      const normalizedX = (e.clientX - centerX) / (rect.width / 2);
      const normalizedY = (e.clientY - centerY) / (rect.height / 2);

      // Map to rotation: mouse moving right tilts card left (negative Y rotation feels natural)
      rotateX.set(-normalizedY * 10);
      rotateY.set(normalizedX * 10);
    },
    [isTiltDisabled, rotateX, rotateY],
  );

  const handleMouseLeave = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
  }, [rotateX, rotateY]);

  if (isTiltDisabled) {
    return <div className={cn('h-full', className)}>{children}</div>;
  }

  return (
    <div style={{ perspective: 1000, borderRadius: 'var(--radius-lg)' }} className={cn('h-full', className)}>
      <motion.div
        ref={ref}
        className="h-full"
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: 'preserve-3d',
          borderRadius: 'var(--radius-lg)',
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        data-testid="tilt-card"
      >
        <div className="h-full" style={{ transform: 'translateZ(50px)', borderRadius: 'var(--radius-lg)' }}>{children}</div>
      </motion.div>
    </div>
  );
}
