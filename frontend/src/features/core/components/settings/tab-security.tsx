import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { useSecurityIgnoreList, useUpdateSecurityIgnoreList } from '@/features/security/hooks/use-security-audit';
import { SettingsSection, DEFAULT_SETTINGS, type SettingsTabProps } from './shared';
import { GroupRoleMappingEditor } from './group-role-mapping-editor';
import { cn } from '@/shared/lib/utils';
import { toast } from 'sonner';

const LazyUsersPanel = lazy(() => import('@/features/core/pages/users').then((m) => ({ default: m.UsersPanel })));

export function SecurityTab({ editedValues, originalValues, onChange, isSaving }: SettingsTabProps) {
  // Filter out group_role_mappings from auto-rendered settings — it has a custom editor
  const authSettings = useMemo(
    () => DEFAULT_SETTINGS.authentication.filter((s) => s.key !== 'oidc.group_role_mappings') as unknown as typeof DEFAULT_SETTINGS.authentication,
    [],
  );

  const isOIDCEnabled = editedValues['oidc.enabled'] === 'true';

  return (
    <div className="space-y-6">
      {/* Authentication Settings */}
      <SettingsSection
        title="Authentication"
        icon={<Shield className="h-5 w-5" />}
        category="authentication"
        settings={authSettings}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        requiresRestart
        disabled={isSaving}
        status={isOIDCEnabled ? 'configured' : 'not-configured'}
        statusLabel={isOIDCEnabled ? 'Enabled' : 'Disabled'}
      />

      {/* Group-to-Role Mapping Editor (only visible when OIDC is enabled) */}
      {isOIDCEnabled && (
        <GroupRoleMappingEditor
          value={editedValues['oidc.group_role_mappings'] ?? '{}'}
          onChange={(val) => onChange('oidc.group_role_mappings', val)}
          disabled={isSaving}
        />
      )}

      {/* Security Audit Ignore List */}
      <SecurityAuditSettingsSection />

      {/* Users */}
      <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
        <LazyUsersPanel />
      </Suspense>
    </div>
  );
}

export function SecurityAuditSettingsSection() {
  const { data, isLoading, isError, error, refetch } = useSecurityIgnoreList();
  const updateIgnoreList = useUpdateSecurityIgnoreList();
  const [draftValue, setDraftValue] = useState('');
  const [lastSavedValue, setLastSavedValue] = useState('');
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasPatternsConfigured = (data?.patterns.length ?? 0) > 0;

  useEffect(() => {
    if (!data) return;
    const initialValue = data.patterns.join('\n');
    setDraftValue(initialValue);
    setLastSavedValue(initialValue);
  }, [data]);

  const parsePatterns = (): string[] => {
    return draftValue
      .split('\n')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  };

  const handleReset = () => {
    if (!data?.defaults) return;
    setDraftValue(data.defaults.join('\n'));
  };

  useEffect(() => {
    if (!data || isLoading || isError) return;
    if (draftValue === lastSavedValue) return;

    const timeout = window.setTimeout(() => {
      setIsAutoSaving(true);
      void updateIgnoreList.mutateAsync(parsePatterns())
        .then(() => {
          setLastSavedValue(draftValue);
          toast.success('Security ignore list updated');
        })
        .catch((err) => {
          toast.error(`Failed to save ignore list: ${err instanceof Error ? err.message : 'Unknown error'}`);
        })
        .finally(() => {
          setIsAutoSaving(false);
        });
    }, 600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [data, draftValue, isError, isLoading, lastSavedValue, updateIgnoreList]);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Security Audit Ignore List</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
            hasPatternsConfigured
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          )}>
            {hasPatternsConfigured ? 'Configured' : 'Not configured'}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading || !data?.defaults}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Reset Defaults
          </button>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          One container name pattern per line. Use <code>*</code> as a wildcard (for example <code>nginx*</code>).
          Ignored containers remain visible in the audit and are marked as ignored.
        </p>
        <p className="text-xs text-muted-foreground">
          {isAutoSaving || updateIgnoreList.isPending ? 'Saving changes...' : 'All changes saved automatically'}
        </p>

        {isError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Failed to load ignore list: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        ) : (
          <textarea
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            className="min-h-[160px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            placeholder="portainer\ntraefik\nnginx*"
            disabled={isLoading || updateIgnoreList.isPending}
          />
        )}
      </div>
    </div>
  );
}
