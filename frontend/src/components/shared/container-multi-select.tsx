import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ContainerOption {
  id: string;
  name: string;
  state: string;
  labels: Record<string, string>;
}

interface ContainerMultiSelectProps {
  containers: ContainerOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

interface ContainerGroup {
  label: string;
  containers: ContainerOption[];
}

function getStateColor(state: string): string {
  if (state === 'running') return 'bg-emerald-500';
  if (state === 'stopped' || state === 'exited' || state === 'dead') return 'bg-red-500';
  if (state === 'unhealthy') return 'bg-red-500';
  if (state === 'paused') return 'bg-yellow-500';
  return 'bg-gray-500';
}

function groupByStack(containers: ContainerOption[]): ContainerGroup[] {
  const groups = new Map<string, ContainerOption[]>();

  for (const container of containers) {
    const stack = container.labels?.['com.docker.compose.project'] || 'Standalone';
    const existing = groups.get(stack);
    if (existing) {
      existing.push(container);
    } else {
      groups.set(stack, [container]);
    }
  }

  // Sort groups: named stacks first (alphabetical), standalone last
  const entries = [...groups.entries()].sort(([a], [b]) => {
    if (a === 'Standalone') return 1;
    if (b === 'Standalone') return -1;
    return a.localeCompare(b);
  });

  return entries.map(([label, conts]) => ({ label, containers: conts }));
}

export function ContainerMultiSelect({
  containers,
  selected,
  onChange,
  className,
}: ContainerMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusIndex, setFocusIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter containers by search term
  const filteredContainers = useMemo(() => {
    if (!search.trim()) return containers;
    const term = search.toLowerCase();
    return containers.filter((c) => c.name.toLowerCase().includes(term));
  }, [containers, search]);

  // Group filtered containers by stack
  const groups = useMemo(() => groupByStack(filteredContainers), [filteredContainers]);

  // Flat list of filtered container IDs for keyboard navigation (matches group render order)
  const flatIds = useMemo(
    () => groups.flatMap((g) => g.containers.map((c) => c.id)),
    [groups],
  );

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
        setFocusIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow dropdown to render
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return;
    const focusedId = flatIds[focusIndex];
    if (!focusedId) return;
    const el = listRef.current.querySelector(`[data-container-id="${focusedId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIndex, flatIds]);

  const toggleContainer = useCallback(
    (id: string) => {
      onChange(
        selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
      );
    },
    [selected, onChange],
  );

  const selectAll = useCallback(() => {
    const allIds = filteredContainers.map((c) => c.id);
    // Merge with already-selected IDs that might be outside the filter
    const merged = new Set([...selected, ...allIds]);
    onChange([...merged]);
  }, [filteredContainers, selected, onChange]);

  const clearAll = useCallback(() => {
    if (search.trim()) {
      // Only clear containers that match the current filter
      const filteredIds = new Set(filteredContainers.map((c) => c.id));
      onChange(selected.filter((id) => !filteredIds.has(id)));
    } else {
      onChange([]);
    }
  }, [search, filteredContainers, selected, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        setSearch('');
        setFocusIndex(-1);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((prev) => (prev < flatIds.length - 1 ? prev + 1 : 0));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : flatIds.length - 1));
        return;
      }

      if (e.key === ' ' && focusIndex >= 0) {
        e.preventDefault();
        const id = flatIds[focusIndex];
        if (id) toggleContainer(id);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusIndex >= 0) {
          const id = flatIds[focusIndex];
          if (id) toggleContainer(id);
        } else {
          setIsOpen(false);
          setSearch('');
        }
        return;
      }
    },
    [flatIds, focusIndex, toggleContainer],
  );

  // Reset focus index when filter changes
  useEffect(() => {
    setFocusIndex(-1);
  }, [search]);

  const selectedNames = useMemo(() => {
    return containers
      .filter((c) => selected.includes(c.id))
      .map((c) => c.name);
  }, [containers, selected]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Select containers, ${selected.length} of ${containers.length} selected`}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm',
          'ring-offset-background transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
        )}
      >
        <span className="truncate text-left">
          {selected.length === 0 && (
            <span className="text-muted-foreground">Select containers...</span>
          )}
          {selected.length > 0 && selected.length <= 3 && (
            <span>{selectedNames.join(', ')}</span>
          )}
          {selected.length > 3 && (
            <span>{selected.length} containers selected</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {selected.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
              {selected.length}/{containers.length}
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', isOpen && 'rotate-180')} />
        </span>
      </button>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" role="list" aria-label="Selected containers">
          {selectedNames.map((name) => {
            const container = containers.find((c) => c.name === name);
            if (!container) return null;
            return (
              <span
                key={container.id}
                role="listitem"
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-foreground"
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', getStateColor(container.state))} />
                {name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleContainer(container.id);
                  }}
                  aria-label={`Remove ${name}`}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label="Container list"
          className={cn(
            'absolute left-0 z-50 mt-1 w-full min-w-[280px] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2',
          )}
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="border-b border-border p-2">
            <div className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-2 transition-shadow focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search containers..."
                aria-label="Search containers"
                className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:shadow-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="rounded p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">
              {selected.length} of {containers.length} selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-primary hover:underline"
                aria-label="Select all containers"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-muted-foreground hover:text-foreground hover:underline"
                aria-label="Clear all selected containers"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Container list */}
          <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
            {filteredContainers.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No containers match &quot;{search}&quot;
              </div>
            )}

            {groups.map((group) => (
              <div key={group.label}>
                <div className="mx-1 mb-1 mt-2 rounded-md border border-border/70 bg-muted/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90 shadow-xs first:mt-1">
                  {group.label}
                </div>
                {group.containers.map((container) => {
                  const isSelected = selected.includes(container.id);
                  const isFocused = flatIds[focusIndex] === container.id;
                  return (
                    <button
                      key={container.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-container-id={container.id}
                      onClick={() => toggleContainer(container.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
                        'cursor-pointer select-none transition-colors',
                        isFocused && 'bg-accent text-accent-foreground',
                        !isFocused && 'hover:bg-accent/50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input',
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', getStateColor(container.state))} />
                      <span className="truncate">{container.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
