import type { CSSProperties } from 'react';
import { useThemeStore } from '@/stores/theme-store';
import { ICON_SET_MAP } from './icon-sets';

interface LoginLogoProps {
  reducedMotion: boolean;
}

export function LoginLogo({ reducedMotion }: LoginLogoProps) {
  const iconId = useThemeStore((s) => s.loginIcon);
  const icon = ICON_SET_MAP[iconId];
  if (!icon) return null;

  const pathClass = reducedMotion ? 'opacity-100' : 'login-logo-path';

  return (
    <svg
      viewBox={icon.viewBox}
      className="login-logo h-14 w-14"
      role="img"
      aria-label={`${icon.label} logo`}
    >
      <defs>
        <linearGradient id="brainStroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="oklch(72% 0.14 244)" />
          <stop offset="100%" stopColor="oklch(78% 0.18 158)" />
        </linearGradient>
      </defs>
      {icon.paths.map((p, i) => (
        <path
          key={i}
          className={pathClass}
          style={{ '--path-delay': `${i * 80}ms` } as CSSProperties}
          d={p.d}
          fill={p.fill === 'currentColor' ? 'url(#brainStroke)' : (p.fill ?? 'none')}
          stroke={p.stroke === 'currentColor' ? 'url(#brainStroke)' : (p.stroke ?? 'none')}
          strokeWidth={p.strokeWidth}
          strokeLinecap={p.strokeLinecap}
          strokeLinejoin={p.strokeLinejoin}
          pathLength={140}
        />
      ))}
    </svg>
  );
}
