import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MappingRow {
  group: string;
  role: 'viewer' | 'operator' | 'admin';
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

export function GroupRoleMappingEditor({ value, onChange, disabled }: GroupRoleMappingEditorProps) {
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
          the <strong>highest-privilege</strong> role is assigned. Use <code>*</code> as
          a wildcard fallback for unmatched groups.
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
                <input
                  type="text"
                  value={row.group}
                  onChange={(e) => updateRow(index, 'group', e.target.value)}
                  disabled={disabled}
                  placeholder="e.g., Dashboard-Admins or *"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  data-testid={`mapping-group-${index}`}
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
