/**
 * Sensitivity preset control (issue #1297).
 *
 * Three-segment toggle (Low / Default / High) that adjusts the per-user
 * anomaly post-filter on the Health & Monitoring page. Updates are
 * optimistic — clicking a segment commits the new preset to the cache
 * immediately and rolls back on PUT failure.
 *
 * Sits next to the severity filter pills inside the search/filter pane on
 * `ai-monitor.tsx`. Personal preference — no admin gate, no Remediation
 * Approval workflow, and the underlying detectors keep writing every
 * anomaly to the shared table (Option A from the issue).
 */
import { Gauge } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import {
  useSensitivityPreset,
  type SensitivityPreset,
} from '@/features/ai-intelligence/hooks/use-sensitivity-preset';

interface PresetMeta {
  value: SensitivityPreset;
  label: string;
  description: string;
}

const PRESETS: PresetMeta[] = [
  { value: 'low', label: 'Low', description: 'Stricter — fewer alerts' },
  { value: 'default', label: 'Default', description: "Today's behaviour" },
  { value: 'high', label: 'High', description: 'Looser — more alerts' },
];

export function SensitivityControl() {
  const { preset, setPreset, isUpdating, updateError } = useSensitivityPreset();

  return (
    <div
      className="flex items-center gap-2"
      data-testid="sensitivity-control"
      role="group"
      aria-label="Anomaly sensitivity preset"
    >
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Gauge className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Sensitivity:</span>
      </div>
      <div className="inline-flex rounded-md border border-input bg-background p-0.5">
        {PRESETS.map((p) => {
          const active = preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                if (p.value !== preset) setPreset(p.value);
              }}
              disabled={isUpdating}
              aria-pressed={active}
              title={p.description}
              data-testid={`sensitivity-${p.value}`}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {updateError && (
        <span
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
          data-testid="sensitivity-error"
        >
          Failed to save preset
        </span>
      )}
    </div>
  );
}
