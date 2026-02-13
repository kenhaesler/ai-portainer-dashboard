import type { CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useThemeStore, type DashboardBackground as DashboardBg } from '@/stores/theme-store';
import { useUiStore } from '@/stores/ui-store';

const PARTICLES = [
  { left: '8%', delay: '0s', duration: '14s', size: '6px' },
  { left: '20%', delay: '1s', duration: '17s', size: '8px' },
  { left: '35%', delay: '0.5s', duration: '15s', size: '7px' },
  { left: '50%', delay: '1.3s', duration: '13s', size: '9px' },
  { left: '65%', delay: '0.3s', duration: '16s', size: '6px' },
  { left: '80%', delay: '0.8s', duration: '12s', size: '8px' },
  { left: '92%', delay: '1.1s', duration: '15s', size: '7px' },
];

const MESH_CLASS_BY_BACKGROUND: Partial<Record<DashboardBg, string>> = {
  'gradient-mesh': 'mesh-classic',
  'gradient-mesh-particles': 'mesh-classic',
  'mesh-aurora': 'mesh-aurora',
  'mesh-ocean': 'mesh-ocean',
  'mesh-sunset': 'mesh-sunset',
  'mesh-nebula': 'mesh-nebula',
  'mesh-emerald': 'mesh-emerald',
  'mesh-glacier': 'mesh-glacier',
  'mesh-emberstorm': 'mesh-emberstorm',
  'mesh-noctis': 'mesh-noctis',
  'mesh-cotton-candy': 'mesh-cotton-candy',
  'mesh-chaos': 'mesh-chaos',
};

function GradientMeshBackground({
  reducedMotion,
  showParticles,
  meshClass,
}: {
  reducedMotion: boolean | null;
  showParticles: boolean;
  meshClass: string;
}) {
  return (
    <>
      <div
        className={`login-gradient-mesh ${meshClass} opacity-60 ${reducedMotion ? '' : 'login-gradient-mesh-animate'}`}
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
    </>
  );
}

function Retro70sBackground() {
  return (
    <div className="retro-bg retro-70s-bg" data-testid="retro-bg">
      <div className="retro-70s-top" />
      <div className="retro-70s-bottom" />
    </div>
  );
}

function RetroArcadeBackground() {
  return (
    <div className="retro-bg retro-arcade-bg" data-testid="retro-bg">
      <div className="retro-arcade-glow" />
    </div>
  );
}

function RetroTerminalBackground() {
  return (
    <div className="retro-bg retro-terminal-bg" data-testid="retro-bg">
      <div className="retro-terminal-vignette" />
    </div>
  );
}

function RetroVaporwaveBackground() {
  return (
    <div className="retro-bg retro-vaporwave-bg" data-testid="retro-bg" />
  );
}

export function DashboardBackground() {
  const bg = useThemeStore((s) => s.dashboardBackground) as DashboardBg;
  const potatoMode = useUiStore((s) => s.potatoMode);
  const reducedMotion = useReducedMotion();

  if (bg === 'none' || potatoMode) return null;

  const showParticles = bg === 'gradient-mesh-particles' && !reducedMotion;
  const meshClass = MESH_CLASS_BY_BACKGROUND[bg];
  const isGradientMesh = Boolean(meshClass);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {isGradientMesh && (
        <GradientMeshBackground
          reducedMotion={reducedMotion}
          showParticles={showParticles}
          meshClass={meshClass as string}
        />
      )}
      {bg === 'retro-70s' && <Retro70sBackground />}
      {bg === 'retro-arcade' && <RetroArcadeBackground />}
      {bg === 'retro-terminal' && <RetroTerminalBackground />}
      {bg === 'retro-vaporwave' && <RetroVaporwaveBackground />}
    </div>
  );
}
