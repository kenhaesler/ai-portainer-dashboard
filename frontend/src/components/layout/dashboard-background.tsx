import type { CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useThemeStore, type DashboardBackground as DashboardBg } from '@/stores/theme-store';

const PARTICLES = [
  { left: '8%', delay: '0s', duration: '14s', size: '6px' },
  { left: '20%', delay: '1s', duration: '17s', size: '8px' },
  { left: '35%', delay: '0.5s', duration: '15s', size: '7px' },
  { left: '50%', delay: '1.3s', duration: '13s', size: '9px' },
  { left: '65%', delay: '0.3s', duration: '16s', size: '6px' },
  { left: '80%', delay: '0.8s', duration: '12s', size: '8px' },
  { left: '92%', delay: '1.1s', duration: '15s', size: '7px' },
];

export function DashboardBackground() {
  const bg = useThemeStore((s) => s.dashboardBackground) as DashboardBg;
  const reducedMotion = useReducedMotion();

  if (bg === 'none') return null;

  const showParticles = bg === 'gradient-mesh-particles' && !reducedMotion;

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div
        className={`login-gradient-mesh opacity-60 ${reducedMotion ? '' : 'login-gradient-mesh-animate'}`}
        data-testid="dashboard-gradient"
      />
      {showParticles && (
        <div className="absolute inset-0">
          {PARTICLES.map((p) => (
            <span
              key={`${p.left}-${p.delay}`}
              className="login-particle"
              style={
                {
                  left: p.left,
                  width: p.size,
                  height: p.size,
                  animationDelay: p.delay,
                  animationDuration: p.duration,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
