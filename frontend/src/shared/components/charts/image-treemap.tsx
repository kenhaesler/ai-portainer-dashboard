import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo, useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { formatBytes } from '@/shared/lib/utils';

interface ImageData {
  [key: string]: unknown;
  name: string;
  size: number;
  children?: ImageData[];
}

interface ImageTreemapProps {
  data: ImageData[];
  /** Called when a treemap cell is activated via click, Enter, or Space */
  onCellClick?: (name: string) => void;
}

/**
 * One hue, luminance-ramped by size.
 *
 * The cells used to cycle an eight-colour pastel rainbow keyed on nothing but
 * the cell's index — the largest saturated area in the product encoding zero
 * information, in a design system where green means healthy and red means
 * error. Area already encodes size; the ramp reinforces that instead of
 * inventing a second, false variable.
 */
const CELL_HUE = 'var(--color-chart-1)';
const MIN_FILL_OPACITY = 0.2;
const MAX_FILL_OPACITY = 0.85;

/**
 * @internal Exported for testing. Maps a cell's size, relative to the largest
 * cell in the same treemap, onto the fill-opacity ramp. `sqrt` keeps the middle
 * of the range separable — image sizes are heavily skewed, so a linear ramp
 * collapses everything but the largest one or two cells onto the floor.
 */
export function getCellFillOpacity(size: number, maxSize: number): number {
  if (!(size > 0) || !(maxSize > 0)) return MIN_FILL_OPACITY;
  const ratio = Math.min(size / maxSize, 1);
  return MIN_FILL_OPACITY + (MAX_FILL_OPACITY - MIN_FILL_OPACITY) * Math.sqrt(ratio);
}

/** @internal Exported for testing only */
export function CustomContent(props: any) {
  const { x, y, width, height, name, size, maxSize, onCellClick } = props;
  const [focused, setFocused] = useState(false);

  // Always render the coloured rect — no invisible blank cells
  const opacity = getCellFillOpacity(size, maxSize);

  const handleKeyDown = (e: ReactKeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (name && onCellClick) {
        onCellClick(name);
      }
    }
  };

  const handleClick = () => {
    if (name && onCellClick) {
      onCellClick(name);
    }
  };

  const ariaLabel = name
    ? `${name}, ${formatBytes(size || 0)}`
    : undefined;

  const inset = 2;

  return (
    <g
      role="button"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ cursor: 'pointer' }}
      className="treemap-cell"
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={CELL_HUE}
        fillOpacity={opacity}
        stroke="var(--color-card)"
        strokeWidth={1}
      />
      {/* Visible focus ring for keyboard navigation */}
      {focused && (
        <rect
          data-testid="focus-ring"
          x={x + inset}
          y={y + inset}
          width={Math.max(0, width - inset * 2)}
          height={Math.max(0, height - inset * 2)}
          fill="none"
          stroke="var(--color-foreground)"
          strokeWidth={2}
          rx={2}
          ry={2}
          pointerEvents="none"
        />
      )}
      {/* Show name label when cell is large enough. Foreground text with a
          card-coloured halo reads on every theme; the old fixed white-on-dark
          pair assumed the cell fill was known at build time. */}
      {width > 50 && height > 24 && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (height > 36 ? 6 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-foreground)"
          stroke="var(--color-card)"
          strokeWidth={2}
          paintOrder="stroke"
          fontSize={Math.min(11, width / 8)}
        >
          {name?.length > Math.floor(width / 7)
            ? name.slice(0, Math.floor(width / 7)) + '...'
            : name}
        </text>
      )}
      {/* Show size when cell is tall enough for two lines */}
      {width > 50 && height > 36 && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          fill="var(--color-muted-foreground)"
          stroke="var(--color-card)"
          strokeWidth={2}
          paintOrder="stroke"
          fontSize={10}
        >
          {formatBytes(size || 0)}
        </text>
      )}
    </g>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const { name, size } = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-foreground">{name}</p>
      <p className="text-muted-foreground">{formatBytes(size)}</p>
    </div>
  );
}

export function ImageTreemap({ data, onCellClick }: ImageTreemapProps) {
  const handleCellClick = useCallback(
    (name: string) => {
      onCellClick?.(name);
    },
    [onCellClick],
  );

  const maxSize = useMemo(
    () => data.reduce((max, d) => (d.size > max ? d.size : max), 0),
    [data],
  );

  if (!data.length) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground">
        No image data
      </div>
    );
  }

  return (
    <div role="group" aria-label="Image size treemap">
      <ResponsiveContainer width="100%" height={400}>
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke="var(--color-card)"
          content={<CustomContent onCellClick={handleCellClick} maxSize={maxSize} />}
        >
          <Tooltip content={<CustomTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
