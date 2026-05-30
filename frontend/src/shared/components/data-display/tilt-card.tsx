import { useRef, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { cn } from '@/shared/lib/utils';
import { useUiStore } from '@/stores/ui-store';

/**
 * Tilt intensity preset. `subtle` keeps the transformed footprint inside the
 * card's own grid cell — use this when the card sits in a dense grid where the
 * default 3D pop would visually intersect neighbouring cards.
 */
export type TiltIntensity = 'default' | 'subtle';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  /**
   * Magnitude of the tilt effect.
   * - `default` (the historical look): ±10deg rotation + 50px Z translation.
   * - `subtle`: ±4deg rotation + 12px Z translation. Safe inside dense KPI grids.
   */
  intensity?: TiltIntensity;
}

const springConfig = { stiffness: 300, damping: 30 };

const INTENSITY_PRESETS: Record<TiltIntensity, { rotation: number; translateZ: number }> = {
  default: { rotation: 10, translateZ: 50 },
  subtle: { rotation: 4, translateZ: 12 },
};

export function TiltCard({ children, className, disabled, intensity = 'default' }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const potatoMode = useUiStore((state) => state.potatoMode);
  const isTiltDisabled = disabled || reducedMotion || potatoMode;

  const { rotation: rotationMagnitude, translateZ } = INTENSITY_PRESETS[intensity];

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
      rotateX.set(-normalizedY * rotationMagnitude);
      rotateY.set(normalizedX * rotationMagnitude);
    },
    [isTiltDisabled, rotateX, rotateY, rotationMagnitude],
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
        data-intensity={intensity}
      >
        <div className="h-full" style={{ transform: `translateZ(${translateZ}px)`, borderRadius: 'var(--radius-lg)' }}>{children}</div>
      </motion.div>
    </div>
  );
}
