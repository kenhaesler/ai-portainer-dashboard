import { Filter } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const BPF_PRESETS = ['tcp', 'udp', 'icmp', 'port 80', 'port 443', 'port 53', 'not port 22'];

export interface BpfFilterInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function BpfFilterInput({ value, onChange }: BpfFilterInputProps) {
  const addPreset = (preset: string) => {
    const trimmed = value.trim();
    onChange(trimmed ? `${trimmed} ${preset}` : preset);
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor="bpf-filter">
        <Filter className="mr-1 inline h-3.5 w-3.5" />
        BPF Filter
      </label>
      <input
        id="bpf-filter"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. port 80 or tcp"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        aria-label="BPF filter"
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {BPF_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => addPreset(preset)}
            className={cn(
              'rounded-md border border-border/60 bg-card/80 px-2 py-0.5 text-xs font-medium text-muted-foreground',
              'transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary',
            )}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
