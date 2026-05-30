import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Search, X, Box, Server } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';
import { filterContainers } from '@/features/containers/lib/workload-search-filter';
import { resolveContainerStackName, NO_STACK_LABEL } from '@/features/containers/lib/container-stack-grouping';

export interface CaptureTarget {
  endpointId: number;
  containerId: string;
  containerName: string;
  endpointName: string;
  stackName: string;
}

export interface CaptureTargetPickerProps {
  containers: Container[];
  stacks: Stack[];
  edgeAsyncEndpointIds: Set<number>;
  value: CaptureTarget | null;
  onChange: (target: CaptureTarget | null) => void;
  autoFocus?: boolean;
}

export function CaptureTargetPicker({
  containers, stacks, edgeAsyncEndpointIds, value, onChange, autoFocus,
}: CaptureTargetPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const knownStackNames = useMemo(() => stacks.map((s) => s.name), [stacks]);
  const matches = useMemo(
    () => filterContainers(containers, query, knownStackNames),
    [containers, query, knownStackNames],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Container[]>();
    for (const c of matches) {
      const arr = map.get(c.endpointName) ?? [];
      arr.push(c);
      map.set(c.endpointName, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [matches]);
  const matchingStacks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.includes(':')) return [];
    return [...new Set(knownStackNames)].filter((n) => n.toLowerCase().includes(q)).slice(0, 4);
  }, [knownStackNames, query]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
        <Box className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-medium">{value.containerName}</span>
        <span className="truncate text-muted-foreground">· {value.endpointName} · {value.stackName}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear selected container"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <Command shouldFilter={false} className="relative">
      <div className="flex items-center gap-2 rounded-md border bg-background px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search containers — name, stack:web, endpoint:prod…"
          className="w-full bg-transparent py-2 text-sm focus:outline-none"
          aria-label="Search capture target container"
        />
      </div>
      {open && query.trim() && (
        <Command.List className="scrollbar-themed absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">
            No running containers match.
          </Command.Empty>

          {matchingStacks.length > 0 && (
            <Command.Group heading="Stacks" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
              {matchingStacks.map((name) => (
                <Command.Item
                  key={`stack-${name}`}
                  value={`stack:${name}`}
                  onSelect={() => setQuery(`stack:${name}`)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm aria-selected:bg-accent"
                >
                  <Server className="h-3.5 w-3.5" /> Stack: {name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {grouped.map(([endpointName, conts]) => (
            <Command.Group
              key={endpointName}
              heading={endpointName}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {conts.map((c) => {
                const disabled = edgeAsyncEndpointIds.has(c.endpointId);
                const stackName = resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL;
                return (
                  <Command.Item
                    key={c.id}
                    value={c.id}
                    disabled={disabled}
                    onSelect={() => {
                      if (disabled) return;
                      onChange({
                        endpointId: c.endpointId,
                        containerId: c.id,
                        containerName: c.name,
                        endpointName: c.endpointName,
                        stackName,
                      });
                      setQuery('');
                      setOpen(false);
                    }}
                    title={disabled ? 'Capture unavailable — Edge Async endpoint (no docker exec)' : undefined}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm aria-selected:bg-accent',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Box className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.image}</span>
                    <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{stackName}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      )}
    </Command>
  );
}
