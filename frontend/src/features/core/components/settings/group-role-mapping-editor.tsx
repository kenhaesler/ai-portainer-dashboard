import { useState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { Plus, Search, Trash2, Users } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatRelativeTime } from '@/shared/lib/format-relative-time';

interface MappingRow {
  group: string;
  role: 'viewer' | 'operator' | 'admin';
}

export interface DiscoveredGroupOption {
  group_name: string;
  user_count: number;
  last_seen_at: string;
}

interface AutocompleteItem {
  name: string;
  user_count?: number;
  last_seen_at?: string;
}

const ROLES = [
  { value: 'viewer' as const, label: 'Viewer' },
  { value: 'operator' as const, label: 'Operator' },
  { value: 'admin' as const, label: 'Admin' },
];

interface GroupRoleMappingEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  discoveredGroups?: DiscoveredGroupOption[];
}

function parseMappings(json: string): MappingRow[] {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return [];
    return Object.entries(parsed).map(([group, role]) => ({
      group,
      role: (['viewer', 'operator', 'admin'].includes(role as string)
        ? role
        : 'viewer') as MappingRow['role'],
    }));
  } catch {
    return [];
  }
}

function serializeMappings(rows: MappingRow[]): string {
  const obj: Record<string, string> = {};
  for (const row of rows) {
    const trimmed = row.group.trim();
    if (trimmed) {
      obj[trimmed] = row.role;
    }
  }
  return JSON.stringify(obj);
}

function extractExistingGroups(rows: MappingRow[], excludeIndex?: number): string[] {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    if (i === excludeIndex) continue;
    const trimmed = rows[i].group.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen].sort();
}

function GroupNameAutocomplete({
  value,
  onChange,
  disabled,
  items,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  items: AutocompleteItem[];
  placeholder?: string;
  testId?: string;
}) {
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const listboxRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [query, items]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [filtered, show]);

  useEffect(() => {
    if (activeIndex < 0 || !listboxRef.current) return;
    const optionEl = listboxRef.current.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    optionEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (group: string) => {
    setQuery(group);
    onChange(group);
    setShow(false);
  };

  const handleBlur = () => {
    setShow(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShow(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      if (filtered.length === 0) return;
      e.preventDefault();
      setShow(true);
      setActiveIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (filtered.length === 0) return;
      e.preventDefault();
      setShow(true);
      setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (show && activeIndex >= 0 && activeIndex < filtered.length) {
        commit(filtered[activeIndex].name);
      } else {
        onChange(query);
        setShow(false);
      }
    }
  };

  const activeDescendant =
    show && activeIndex >= 0 && activeIndex < filtered.length
      ? `${optionIdPrefix}-${activeIndex}`
      : undefined;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={show && filtered.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShow(true);
            onChange(e.target.value);
          }}
          onFocus={() => setShow(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          data-testid={testId}
          autoComplete="off"
        />
      </div>
      {show && filtered.length > 0 && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {filtered.map((item, index) => {
            const isActive = index === activeIndex;
            const hasMetadata = typeof item.user_count === 'number';
            return (
              <div
                key={item.name}
                id={`${optionIdPrefix}-${index}`}
                role="option"
                aria-selected={isActive}
                data-option-index={index}
                className={cn(
                  'px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground',
                  isActive ? 'bg-accent text-accent-foreground' : '',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(item.name);
                }}
              >
                <div>{item.name}</div>
                {hasMetadata && (
                  <div className="text-xs text-muted-foreground">
                    {item.user_count} {item.user_count === 1 ? 'user' : 'users'}
                    {item.last_seen_at && ` · last seen ${formatRelativeTime(item.last_seen_at)}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GroupRoleMappingEditor({ value, onChange, disabled, discoveredGroups }: GroupRoleMappingEditorProps) {
  const [rows, setRows] = useState<MappingRow[]>(() => parseMappings(value));

  // Sync from parent when value changes externally
  useEffect(() => {
    const parsed = parseMappings(value);
    setRows(parsed);
  }, [value]);

  const emitChange = useCallback(
    (newRows: MappingRow[]) => {
      setRows(newRows);
      onChange(serializeMappings(newRows));
    },
    [onChange],
  );

  const addRow = () => {
    emitChange([...rows, { group: '', role: 'viewer' }]);
  };

  const removeRow = (index: number) => {
    emitChange(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof MappingRow, val: string) => {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, [field]: val } : row,
    );
    emitChange(updated);
  };

  const baseItems = useMemo<AutocompleteItem[]>(
    () =>
      (discoveredGroups ?? []).map((g) => ({
        name: g.group_name,
        user_count: g.user_count,
        last_seen_at: g.last_seen_at,
      })),
    [discoveredGroups],
  );

  const itemsByRow = useMemo<AutocompleteItem[][]>(() => {
    const baseNames = new Set(baseItems.map((item) => item.name));
    return rows.map((_, index) => {
      const extras = extractExistingGroups(rows, index)
        .filter((name) => !baseNames.has(name))
        .map<AutocompleteItem>((name) => ({ name }));
      return extras.length === 0 ? baseItems : [...baseItems, ...extras];
    });
  }, [baseItems, rows]);

  return (
    <div className="rounded-lg border bg-card" data-testid="group-role-mapping-editor">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <h3 className="text-base font-semibold">Group-to-Role Mappings</h3>
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium',
            'hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Mapping
        </button>
      </div>

      <div className="p-4 space-y-2">
        <p className="text-sm text-muted-foreground mb-3">
          Map IdP group names to dashboard roles. If a user belongs to multiple groups,
          the <strong>highest-privilege</strong> role is assigned. URI prefixes (e.g.,{' '}
          <code>urn:pingidentity.com:groups:</code>) are stripped automatically — enter
          the group name only. Use <code>*</code> as a wildcard fallback for unmatched
          groups.
        </p>

        {rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No mappings configured. OIDC users will default to <strong>viewer</strong> role.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[1fr_160px_40px] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>IdP Group Name</span>
              <span>Dashboard Role</span>
              <span />
            </div>

            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_160px_40px] gap-2 items-center">
                <GroupNameAutocomplete
                  value={row.group}
                  onChange={(val) => updateRow(index, 'group', val)}
                  disabled={disabled}
                  items={itemsByRow[index]}
                  placeholder="e.g., Dashboard-Admins or *"
                  testId={`mapping-group-${index}`}
                />
                <select
                  value={row.role}
                  onChange={(e) => updateRow(index, 'role', e.target.value)}
                  disabled={disabled}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  data-testid={`mapping-role-${index}`}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={disabled}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  data-testid={`mapping-remove-${index}`}
                  aria-label={`Remove mapping for ${row.group || 'empty group'}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
