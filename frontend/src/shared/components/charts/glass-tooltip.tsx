interface GlassTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    unit?: string;
  }>;
  label?: string;
}

export function GlassTooltip({ active, payload, label }: GlassTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      data-testid="glass-tooltip"
      className="rounded-lg border border-white/10 bg-gray-900/80 px-3 py-2 text-sm text-white shadow-xl backdrop-blur-md"
    >
      {label && (
        <p className="mb-1 text-xs text-gray-400">{label}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2">
          {entry.color && (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
          )}
          <span className="text-gray-300">{entry.name}:</span>
          <span className="font-medium">
            {entry.value != null ? entry.value.toFixed(1) : '\u2014'}
            {entry.unit ?? ''}
          </span>
        </p>
      ))}
    </div>
  );
}
