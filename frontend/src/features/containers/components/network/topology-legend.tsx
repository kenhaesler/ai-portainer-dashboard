import { useState } from 'react';
import { Info, ChevronDown } from 'lucide-react';

/**
 * Node shapes. This is the first thing that needs explaining and the legend
 * never mentioned it: a circle is a container, a diamond is a network.
 */
const SHAPE_ENTRIES = [
  { shape: 'circle', label: 'Container' },
  { shape: 'diamond', label: 'Network' },
] as const;

/** Container state, read from the fill of the circle. */
const STATE_ENTRIES = [
  { color: '#10b981', label: 'Running' },
  { color: '#f59e0b', label: 'Paused' },
  { color: '#ef4444', label: 'Stopped' },
  { color: '#6b7280', label: 'Unknown' },
] as const;

/** Edge colour, read from throughput on the container ↔ network link. */
const LEGEND_ENTRIES = [
  { color: '#6b7280', label: 'No data / Idle' },
  { color: '#10b981', label: 'Low (< 10 KB/s)' },
  { color: '#eab308', label: 'Medium (10–100 KB/s)' },
  { color: '#f97316', label: 'High (100 KB/s – 1 MB/s)' },
  { color: '#ef4444', label: 'Very High (>= 1 MB/s)' },
] as const;

/**
 * Legend for the topology canvas.
 *
 * It used to open closed and document only Edge Load — the one dimension that
 * is constant on an idle fleet, where every edge reads 0 B/s — while never
 * explaining the circle/diamond distinction or the node state colours, which
 * are the two things a first-time viewer actually needs. Node shape and state
 * now come first, edge load last, and the panel opens by default.
 */
export function TopologyLegend() {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-4 left-16 z-10">
      {open && (
        <div className="mb-2 max-h-[60vh] overflow-y-auto rounded-lg border bg-card/95 backdrop-blur-sm p-3 shadow-lg">
          <p className="text-xs font-semibold text-foreground mb-2">Node</p>
          <div className="space-y-1.5">
            {SHAPE_ENTRIES.map((entry) => (
              <div key={entry.shape} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={
                    entry.shape === 'circle'
                      ? 'inline-block h-3 w-3 rounded-full border border-foreground/40 bg-muted-foreground/40'
                      : 'inline-block h-3 w-3 rotate-45 border border-foreground/40 bg-muted-foreground/40'
                  }
                />
                <span className="text-xs text-muted-foreground">{entry.label}</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs font-semibold text-foreground mb-2">Container State</p>
          <div className="space-y-1.5">
            {STATE_ENTRIES.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs text-muted-foreground">{entry.label}</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs font-semibold text-foreground mb-2">Edge Load</p>
          <div className="space-y-1.5">
            {LEGEND_ENTRIES.map((entry) => (
              <div key={entry.color} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
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
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card/95 backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground hover:bg-accent"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        Legend
        <ChevronDown
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  );
}
