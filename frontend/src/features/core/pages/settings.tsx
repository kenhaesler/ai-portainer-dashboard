import { useState, useEffect, useMemo, useCallback } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  HardDriveDownload,
  Info,
  Loader2,
  Palette,
  Plug,
  Settings2,
  Shield,
} from 'lucide-react';
import { useSettings, useUpdateSetting } from '@/features/core/hooks/use-settings';
import { useAuth } from '@/providers/auth-provider';
import { useThemeStore } from '@/stores/theme-store';
import { SkeletonCard } from '@/shared/components/loading-skeleton';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

import { DEFAULT_SETTINGS, SETTING_CATEGORY_BY_KEY } from '@/features/core/components/settings/shared';
import { GeneralTab, getRedisSystemInfo } from '@/features/core/components/settings/tab-general';
import { SecurityTab } from '@/features/core/components/settings/tab-security';
import { AiLlmTab, LlmSettingsSection, LLM_SETTING_KEYS } from '@/features/core/components/settings/tab-ai-llm';
import { MonitoringTab } from '@/features/core/components/settings/tab-monitoring';
import { IntegrationsTab } from '@/features/core/components/settings/tab-integrations';
import { InfrastructureTab } from '@/features/core/components/settings/tab-infrastructure';
import { AppearanceTab } from '@/features/core/components/settings/tab-appearance';

// Re-export for tests and other consumers
export { LlmSettingsSection, getRedisSystemInfo };
export { AiPromptsTab } from '@/features/core/components/settings/tab-ai-llm';
export { ElasticsearchSettingsSection, HarborSettingsSection } from '@/features/core/components/settings/tab-integrations';
export { SecurityAuditSettingsSection } from '@/features/core/components/settings/tab-security';
export { NotificationHistoryPanel, NotificationTestButtons } from '@/features/core/components/settings/tab-monitoring';

// ─── Tab definitions ─────────────────────────────────────────────────

type SettingsTab = 'general' | 'security' | 'ai' | 'monitoring' | 'integrations' | 'infrastructure' | 'appearance';

const VALID_TABS: SettingsTab[] = ['general', 'security', 'ai', 'monitoring', 'integrations', 'infrastructure', 'appearance'];

/** Map old bookmark/deep-link tab names to their new equivalents. */
const TAB_ALIASES: Record<string, SettingsTab> = {
  users: 'security',
  webhooks: 'integrations',
  'ai-prompts': 'ai',
  'ai-feedback': 'ai',
  'portainer-backup': 'infrastructure',
};

function resolveTab(raw: string | null): SettingsTab {
  if (!raw) return 'general';
  if (VALID_TABS.includes(raw as SettingsTab)) return raw as SettingsTab;
  return TAB_ALIASES[raw] ?? 'general';
}

const TAB_META: { value: SettingsTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { value: 'general', label: 'General', icon: <Settings2 className="h-4 w-4" /> },
  { value: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { value: 'ai', label: 'AI & LLM', icon: <Bot className="h-4 w-4" />, adminOnly: true },
  { value: 'monitoring', label: 'Monitoring', icon: <Activity className="h-4 w-4" /> },
  { value: 'integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
  { value: 'infrastructure', label: 'Infrastructure', icon: <HardDriveDownload className="h-4 w-4" /> },
  { value: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
];

const TAB_TRIGGER_CLASS =
  'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary';

// ─── Page component ──────────────────────────────────────────────────

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = useAuth();
  const { theme } = useThemeStore();
  const { data: settingsData, isLoading, isError, error, refetch } = useSettings();
  const updateSetting = useUpdateSetting();

  // Local state for edited / original values
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);

  // Active tab (URL-driven)
  const initialTab = resolveTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Sync URL → tab
  useEffect(() => {
    setActiveTab((cur) => {
      const requested = resolveTab(searchParams.get('tab'));
      return cur === requested ? cur : requested;
    });
  }, [searchParams]);

  // Initialize from API
  useEffect(() => {
    if (settingsData) {
      const settingsArray = Array.isArray(settingsData)
        ? settingsData
        : (settingsData as { settings?: unknown[] }).settings || [];

      const values: Record<string, string> = {};
      (settingsArray as Array<{ key: string; value: string }>).forEach((s) => {
        values[s.key] = s.value;
      });

      // Fill defaults for missing keys
      Object.values(DEFAULT_SETTINGS).flat().forEach((setting) => {
        if (!(setting.key in values)) {
          values[setting.key] = setting.defaultValue;
        }
      });

      setEditedValues(values);
      setOriginalValues(values);
      setSaveSuccess(false);
      setSaveError(null);
      setRestartPending(false);
    }
  }, [settingsData]);

  // ── Change detection ─────────────────────────────────────────────

  const hasChanges = useMemo(
    () => Object.keys(editedValues).some((key) => editedValues[key] !== originalValues[key]),
    [editedValues, originalValues],
  );

  const restartKeys = useMemo(() => [
    'monitoring.polling_interval',
    'monitoring.enabled',
    'llm.ollama_url',
    'llm.model',
    'llm.custom_endpoint_enabled',
    'llm.custom_endpoint_url',
    'llm.custom_endpoint_token',
    'llm.auth_type',
    'oidc.enabled',
    'oidc.issuer_url',
    'oidc.client_id',
    'oidc.client_secret',
    'notifications.teams_enabled',
    'notifications.teams_webhook_url',
    'notifications.email_enabled',
    'notifications.smtp_host',
    'notifications.smtp_port',
    'notifications.smtp_user',
    'notifications.smtp_password',
    'notifications.email_recipients',
    'notifications.discord_enabled',
    'notifications.discord_webhook_url',
    'notifications.telegram_enabled',
    'notifications.telegram_bot_token',
    'notifications.telegram_chat_id',
    'webhooks.enabled',
    'portainer_backup.enabled',
    'portainer_backup.interval_hours',
    'harbor.enabled',
    'harbor.api_url',
    'harbor.robot_name',
    'harbor.robot_secret',
    'harbor.verify_ssl',
    'harbor.sync_interval_minutes',
  ], []);

  const changesRequireRestart = useMemo(
    () => restartKeys.some((key) => editedValues[key] !== originalValues[key]),
    [editedValues, originalValues, restartKeys],
  );

  // ── Handlers ─────────────────────────────────────────────────────

  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
    setSaveError(null);
  };

  /** Persist a set of changed keys to the API. */
  const saveChangedSettings = useCallback(async (
    editedSnapshot: Record<string, string>,
    originalSnapshot: Record<string, string>,
    /** When set, only save keys in this list. */
    filterKeys?: readonly string[],
  ) => {
    const changedKeys = Object.keys(editedSnapshot).filter((key) => {
      if (editedSnapshot[key] === originalSnapshot[key]) return false;
      if (filterKeys && !filterKeys.includes(key)) return false;
      return true;
    });
    if (changedKeys.length === 0) return;

    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    let hadFailure = false;
    const appliedValues: Record<string, string> = {};
    let appliedRestartSetting = false;

    for (const key of changedKeys) {
      try {
        await updateSetting.mutateAsync({
          key,
          value: editedSnapshot[key],
          category: SETTING_CATEGORY_BY_KEY[key],
          showToast: false,
        });
        appliedValues[key] = editedSnapshot[key];
        if (restartKeys.includes(key)) {
          appliedRestartSetting = true;
        }
      } catch {
        hadFailure = true;
      }
    }

    if (Object.keys(appliedValues).length > 0) {
      setOriginalValues((prev) => ({ ...prev, ...appliedValues }));
      setSaveSuccess(true);
      if (appliedRestartSetting) {
        setRestartPending(true);
      }
    }

    if (hadFailure) {
      setSaveError('Failed to auto-save some settings');
      toast.error('Failed to auto-save some settings');
    }

    setIsSaving(false);
  }, [restartKeys, updateSetting]);

  // ── Auto-save (excluding LLM keys) ──────────────────────────────

  useEffect(() => {
    // Only auto-save non-LLM keys
    const nonLlmChanged = Object.keys(editedValues).some(
      (key) => editedValues[key] !== originalValues[key] && !(LLM_SETTING_KEYS as readonly string[]).includes(key),
    );
    if (isSaving || !nonLlmChanged) return;

    const editedSnapshot = { ...editedValues };
    const originalSnapshot = { ...originalValues };
    // Build the filter list: every key *except* LLM keys
    const nonLlmKeys = Object.keys(editedSnapshot).filter((k) => !(LLM_SETTING_KEYS as readonly string[]).includes(k));

    const timeout = window.setTimeout(() => {
      void saveChangedSettings(editedSnapshot, originalSnapshot, nonLlmKeys);
    }, 700);

    return () => { window.clearTimeout(timeout); };
  }, [editedValues, isSaving, originalValues, saveChangedSettings]);

  // ── LLM explicit save helpers (passed to AiLlmTab) ──────────────

  const hasLlmChanges = useMemo(
    () => LLM_SETTING_KEYS.some((key) => editedValues[key] !== originalValues[key]),
    [editedValues, originalValues],
  );

  const saveLlmSettings = useCallback(async () => {
    await saveChangedSettings({ ...editedValues }, { ...originalValues }, LLM_SETTING_KEYS);
    toast.success('LLM settings saved');
  }, [editedValues, originalValues, saveChangedSettings]);

  const resetLlmValues = useCallback(() => {
    setEditedValues((prev) => {
      const next = { ...prev };
      for (const key of LLM_SETTING_KEYS) {
        next[key] = originalValues[key] ?? next[key];
      }
      return next;
    });
  }, [originalValues]);

  // ── Reset all ────────────────────────────────────────────────────

  const handleReset = () => {
    setEditedValues({ ...originalValues });
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleTabChange = (tab: string) => {
    const resolved = resolveTab(tab);
    setActiveTab(resolved);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (resolved === 'general') {
        next.delete('tab');
      } else {
        next.set('tab', resolved);
      }
      return next;
    }, { replace: true });
  };

  // ── Loading / Error states ───────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
        <div className="grid gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Environment, backup, monitoring, and cache configuration
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="font-semibold">Failed to load settings</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Unknown error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Shared tab props ─────────────────────────────────────────────

  const tabProps = {
    editedValues,
    originalValues,
    onChange: handleChange,
    isSaving,
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Environment, backup, monitoring, and cache configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving changes...
            </div>
          )}
          {!isSaving && saveError && (
            <div className="text-sm text-destructive">{saveError}</div>
          )}
          {!isSaving && !saveError && saveSuccess && !hasChanges && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              All changes saved
            </div>
          )}
          {hasChanges && (
            <button
              onClick={handleReset}
              disabled={isSaving}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Restart Warning */}
      {(changesRequireRestart || restartPending) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-500">Restart Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Some settings changes require a backend restart to take effect.
              Changes are auto-saved; restart the backend service to apply them.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <Tabs.List className="flex items-center gap-1 border-b overflow-x-auto">
          {TAB_META.filter((t) => !t.adminOnly || role === 'admin').map((t) => (
            <Tabs.Trigger key={t.value} value={t.value} className={TAB_TRIGGER_CLASS}>
              {t.icon}
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="general" className="space-y-6 focus:outline-none">
          <GeneralTab theme={theme} />
        </Tabs.Content>

        <Tabs.Content value="security" className="space-y-6 focus:outline-none">
          <SecurityTab {...tabProps} />
        </Tabs.Content>

        {role === 'admin' && (
          <Tabs.Content value="ai" className="space-y-6 focus:outline-none">
            <AiLlmTab
              {...tabProps}
              role={role}
              saveLlmSettings={saveLlmSettings}
              hasLlmChanges={hasLlmChanges}
              resetLlmValues={resetLlmValues}
            />
          </Tabs.Content>
        )}

        <Tabs.Content value="monitoring" className="space-y-6 focus:outline-none">
          <MonitoringTab {...tabProps} />
        </Tabs.Content>

        <Tabs.Content value="integrations" className="space-y-6 focus:outline-none">
          <IntegrationsTab {...tabProps} />
        </Tabs.Content>

        <Tabs.Content value="infrastructure" className="space-y-6 focus:outline-none">
          <InfrastructureTab {...tabProps} />
        </Tabs.Content>

        <Tabs.Content value="appearance" className="space-y-6 focus:outline-none">
          <AppearanceTab />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
