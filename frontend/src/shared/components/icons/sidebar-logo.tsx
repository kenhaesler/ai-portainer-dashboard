import { useThemeStore } from '@/stores/theme-store';
import { ICON_SET_MAP } from './icon-sets';

export function SidebarLogo() {
  const iconId = useThemeStore((s) => s.sidebarIcon);
  const icon = ICON_SET_MAP[iconId];
  if (!icon) return null;

  return (
    <svg
      viewBox={icon.viewBox}
      className="h-4 w-4"
      role="img"
      aria-label={`${icon.label} logo`}
    >
      {icon.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ?? 'none'}
          stroke={p.stroke ?? 'none'}
          strokeWidth={p.strokeWidth}
          strokeLinecap={p.strokeLinecap}
          strokeLinejoin={p.strokeLinejoin}
        />
      ))}
    </svg>
  );
}
