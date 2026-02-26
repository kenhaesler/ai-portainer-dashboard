export type AppIconId =
  | 'brain'
  | 'neural-net'
  | 'circuit-brain'
  | 'docker-ai'
  | 'cube-scan'
  | 'eye-ai'
  | 'hexagon-mesh'
  | 'pulse-shield'
  | 'atom-orbit'
  | 'lighthouse';

export interface IconPath {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: 'round' | 'butt' | 'square';
  strokeLinejoin?: 'round' | 'bevel' | 'miter';
}

export interface IconSetDefinition {
  id: AppIconId;
  label: string;
  description: string;
  viewBox: string;
  paths: IconPath[];
}

export const ICON_SETS: IconSetDefinition[] = [
  {
    id: 'brain',
    label: 'Brain',
    description: 'Classic AI brain',
    viewBox: '0 0 64 64',
    paths: [
      {
        d: 'M22 16c-5 0-9 4.5-9 10 0 2 .8 3.5 1.8 5.2-.8 1.5-1.8 3-1.8 5.8 0 5.5 3.5 9.5 9 10 2 3.5 5.5 5.5 10 5.5',
        stroke: 'currentColor',
        strokeWidth: 3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      {
        d: 'M42 16c5 0 9 4.5 9 10 0 2-.8 3.5-1.8 5.2.8 1.5 1.8 3 1.8 5.8 0 5.5-3.5 9.5-9 10-2 3.5-5.5 5.5-10 5.5',
        stroke: 'currentColor',
        strokeWidth: 3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      {
        d: 'M25 25c2.5-3 11.5-3 14 0M23 33c3.5-2.5 14.5-2.5 18 0M25 41c4-2 10-2 14 0',
        stroke: 'currentColor',
        strokeWidth: 3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  {
    id: 'neural-net',
    label: 'Neural Net',
    description: 'Connected nodes',
    viewBox: '0 0 64 64',
    paths: [
      // Edges (drawn first, behind nodes)
      {
        d: 'M16 20L32 12 M16 20L32 32 M16 44L32 32 M16 44L32 52 M32 12L48 20 M32 32L48 20 M32 32L48 44 M32 52L48 44',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
      },
      // Left column nodes
      {
        d: 'M16 20m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M16 44m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 1,
      },
      // Middle column nodes
      {
        d: 'M32 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M32 32m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M32 52m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 1,
      },
      // Right column nodes
      {
        d: 'M48 20m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M48 44m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 1,
      },
    ],
  },
  {
    id: 'circuit-brain',
    label: 'Circuit Brain',
    description: 'Brain with circuits',
    viewBox: '0 0 64 64',
    paths: [
      // Brain outline
      {
        d: 'M22 14c-6 0-10 5-10 11 0 2 1 4 2 6-1 2-2 3-2 6 0 6 4 11 10 11 2 4 6 6 10 6s8-2 10-6c6 0 10-5 10-11 0-3-1-4-2-6 1-2 2-4 2-6 0-6-4-11-10-11',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Circuit traces
      {
        d: 'M24 26h4l3 3h4l3-3h4 M20 34h6l2 2h8l2-2h6 M26 42h3l2-2h2l2 2h3',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Circuit nodes
      {
        d: 'M28 26m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M36 26m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M32 34m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
        fill: 'currentColor',
      },
    ],
  },
  {
    id: 'docker-ai',
    label: 'Container AI',
    description: 'Container + sparkle',
    viewBox: '0 0 64 64',
    paths: [
      // Container box
      {
        d: 'M14 22l18-10 18 10v20l-18 10-18-10z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Inner lines
      {
        d: 'M14 22l18 10 18-10 M32 32v20',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Sparkle (4-point star) top-right
      {
        d: 'M48 8l1.5 4.5L54 14l-4.5 1.5L48 20l-1.5-4.5L42 14l4.5-1.5z',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 0.5,
        strokeLinejoin: 'round',
      },
    ],
  },
  {
    id: 'cube-scan',
    label: 'Cube Scan',
    description: 'Monitoring cube',
    viewBox: '0 0 64 64',
    paths: [
      // 3D cube
      {
        d: 'M18 24l14-8 14 8v16l-14 8-14-8z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      {
        d: 'M18 24l14 8 14-8 M32 32v16',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Scan bracket top-left
      {
        d: 'M10 10h8 M10 10v8',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
      },
      // Scan bracket top-right
      {
        d: 'M54 10h-8 M54 10v8',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
      },
      // Scan bracket bottom-left
      {
        d: 'M10 54h8 M10 54v-8',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
      },
      // Scan bracket bottom-right
      {
        d: 'M54 54h-8 M54 54v-8',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
      },
    ],
  },
  {
    id: 'eye-ai',
    label: 'AI Eye',
    description: 'Digital iris',
    viewBox: '0 0 64 64',
    paths: [
      // Eye outline
      {
        d: 'M8 32s10-16 24-16 24 16 24 16-10 16-24 16S8 32 8 32z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Outer iris
      {
        d: 'M32 24a8 8 0 1 1 0 16 8 8 0 0 1 0-16z',
        stroke: 'currentColor',
        strokeWidth: 2,
      },
      // Inner pupil
      {
        d: 'M32 28a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
        fill: 'currentColor',
      },
      // Digital scan lines
      {
        d: 'M32 16v4 M32 44v4 M22 19l1 2 M42 19l-1 2',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      },
    ],
  },
  {
    id: 'hexagon-mesh',
    label: 'Hex Mesh',
    description: 'Honeycomb grid',
    viewBox: '0 0 64 64',
    paths: [
      // Center hexagon
      {
        d: 'M32 12l10 5.8v11.5L32 35 22 29.3V17.8z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinejoin: 'round',
      },
      // Left hexagon
      {
        d: 'M12 24l10 5.8v11.5L12 47 2 41.3V29.8z',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
      },
      // Right hexagon
      {
        d: 'M52 24l10 5.8v11.5L52 47 42 41.3V29.8z',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
      },
      // Bottom hexagon
      {
        d: 'M32 36l10 5.8v11.5L32 59 22 53.3V41.8z',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
      },
    ],
  },
  {
    id: 'pulse-shield',
    label: 'Pulse Shield',
    description: 'Health + protection',
    viewBox: '0 0 64 64',
    paths: [
      // Shield
      {
        d: 'M32 6L10 16v16c0 14 10 22 22 26 12-4 22-12 22-26V16z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Heartbeat line
      {
        d: 'M16 34h8l3-8 5 16 5-16 3 8h8',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  {
    id: 'atom-orbit',
    label: 'Atom',
    description: 'Orbital ellipses',
    viewBox: '0 0 64 64',
    paths: [
      // Horizontal orbit
      {
        d: 'M32 26c12 0 22 2.5 22 6s-10 6-22 6-22-2.5-22-6 10-6 22-6z',
        stroke: 'currentColor',
        strokeWidth: 2,
      },
      // Angled orbit 1
      {
        d: 'M22.6 16.6c6-10.4 14-15.4 17.4-13.4s1.4 11-4.6 21.4-14 15.4-17.4 13.4-1.4-11 4.6-21.4z',
        stroke: 'currentColor',
        strokeWidth: 2,
      },
      // Angled orbit 2
      {
        d: 'M41.4 16.6c-6-10.4-14-15.4-17.4-13.4s-1.4 11 4.6 21.4 14 15.4 17.4 13.4 1.4-11-4.6-21.4z',
        stroke: 'currentColor',
        strokeWidth: 2,
      },
      // Nucleus
      {
        d: 'M32 32m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
        fill: 'currentColor',
      },
    ],
  },
  {
    id: 'lighthouse',
    label: 'Lighthouse',
    description: 'Observability beacon',
    viewBox: '0 0 64 64',
    paths: [
      // Tower body
      {
        d: 'M26 56l2-30h8l2 30z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Lantern room
      {
        d: 'M24 26h16v-6H24z',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinejoin: 'round',
      },
      // Dome
      {
        d: 'M27 20a5 5 0 0 1 10 0',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
      },
      // Light beams
      {
        d: 'M24 23H10 M40 23h14 M22 18L12 12 M42 18l10-6',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
      },
      // Base
      {
        d: 'M20 56h24',
        stroke: 'currentColor',
        strokeWidth: 2.5,
        strokeLinecap: 'round',
      },
    ],
  },
];

export const ICON_SET_MAP: Record<AppIconId, IconSetDefinition> = Object.fromEntries(
  ICON_SETS.map((icon) => [icon.id, icon])
) as Record<AppIconId, IconSetDefinition>;

export const iconSetOptions: { value: AppIconId; label: string; description: string }[] =
  ICON_SETS.map(({ id, label, description }) => ({ value: id, label, description }));

export function buildFaviconSvg(iconId: AppIconId): string {
  const icon = ICON_SET_MAP[iconId];
  if (!icon) return '';

  const pathMarkup = icon.paths
    .map((p) => {
      const attrs: string[] = [`d="${p.d}"`];
      const fill = p.fill === 'currentColor' ? '#fff' : (p.fill ?? 'none');
      attrs.push(`fill="${fill}"`);
      const stroke = p.stroke === 'currentColor' ? '#fff' : (p.stroke ?? 'none');
      if (stroke !== 'none') {
        attrs.push(`stroke="${stroke}"`);
        if (p.strokeWidth) attrs.push(`stroke-width="${p.strokeWidth}"`);
        if (p.strokeLinecap) attrs.push(`stroke-linecap="${p.strokeLinecap}"`);
        if (p.strokeLinejoin) attrs.push(`stroke-linejoin="${p.strokeLinejoin}"`);
      }
      return `<path ${attrs.join(' ')}/>`;
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">`,
    '<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#3b82f6"/>',
    '<stop offset="100%" stop-color="#22c55e"/>',
    '</linearGradient></defs>',
    '<rect width="64" height="64" rx="14" fill="url(#bg)"/>',
    pathMarkup,
    '</svg>',
  ].join('');
}
