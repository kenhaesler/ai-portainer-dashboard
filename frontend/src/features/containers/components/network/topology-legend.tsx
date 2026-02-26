import { useState } from 'react';
import { Info, ChevronDown } from 'lucide-react';

const LEGEND_ENTRIES = [
  { color: '#6b7280', label: 'No data / Idle' },
  { color: '#10b981', label: 'Low (< 10 KB/s)' },
  { color: '#eab308', label: 'Medium (10–100 KB/s)' },
  { color: '#f97316', label: 'High (100 KB/s – 1 MB/s)' },
  { color: '#ef4444', label: 'Very High (>= 1 MB/s)' },
] as const;

export function TopologyLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute bottom-14 left-3 z-10">
      {open && (
        <div className="mb-2 rounded-lg border bg-card/95 backdrop-blur-sm p-3 shadow-lg">
          <p className="text-xs font-semibold text-foreground mb-2">Edge Load</p>
          <div className="space-y-1.5">
            {LEGEND_ENTRIES.map((entry) => (
              <div key={entry.color} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-6 rounded-sm"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs text-muted-foreground">{entry.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card/95 backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground hover:bg-accent"
      >
        <Info className="h-3.5 w-3.5" />
        Legend
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
}
