import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HardDriveDownload,
  Info,
  Loader2,
  Palette,
  Plug,
  Search,
  Settings2,
  Shield,
} from 'lucide-react';
import { PageHeader } from '@/shared/components/layout/page-header';
import { useSettings, useUpdateSetting } from '@/features/core/hooks/use-settings';
import { useAuth } from '@/providers/auth-provider';
import { useThemeStore } from '@/stores/theme-store';
import { SkeletonText } from '@/shared/components/feedback/skeleton';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

import {
  DEFAULT_SETTINGS,
  SETTING_BY_KEY,
  SETTING_CATEGORY_BY_KEY,
  SettingsSavedKeysProvider,
  isGuardedSetting,
  searchSettings,
  settingConsequence,
  settingDomId,
  settingRisk,
  shrinksRetentionWindow,
  type SettingCategory,
} from '@/features/core/components/settings/shared';
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

/**
 * The tab an admin lands on with no `?tab=`.
 *
 * It used to be `general`, which contains no settings at all — version strings,
 * cache counters, and a page of Redis key hashes. Someone opening Settings has
 * come to change something, so land them on a tab that can be changed.
 */
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'monitoring';

/** Map old bookmark/deep-link tab names to their new equivalents. */
const TAB_ALIASES: Record<string, SettingsTab> = {
  users: 'security',
  webhooks: 'integrations',
  'ai-prompts': 'ai',
  'ai-feedback': 'ai',
  'portainer-backup': 'infrastructure',
};

export function resolveTab(raw: string | null): SettingsTab {
  if (!raw) return DEFAULT_SETTINGS_TAB;
  if (VALID_TABS.includes(raw as SettingsTab)) return raw as SettingsTab;
  return TAB_ALIASES[raw] ?? DEFAULT_SETTINGS_TAB;
}

const TAB_META: { value: SettingsTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { value: 'monitoring', label: 'Monitoring', icon: <Activity className="h-4 w-4" /> },
  { value: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { value: 'ai', label: 'AI & LLM', icon: <Bot className="h-4 w-4" />, adminOnly: true },
  { value: 'integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
  { value: 'infrastructure', label: 'Infrastructure', icon: <HardDriveDownload className="h-4 w-4" /> },
  { value: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
  // Last, and named for what it holds: read-only version and cache information.
  { value: 'general', label: 'About', icon: <Settings2 className="h-4 w-4" /> },
];

const TAB_TRIGGER_CLASS =
  'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors hover:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary';

const SETTINGS_SUBTITLE = 'Environment, backup, monitoring, and cache configuration';

/** Which tab renders each settings category — the target of a search result. */
const TAB_BY_CATEGORY: Record<SettingCategory, SettingsTab> = {
  monitoring: 'monitoring',
  anomaly: 'monitoring',
  notifications: 'monitoring',
  authentication: 'security',
  statusPage: 'security',
  llm: 'ai',
  mcp: 'ai',
  aiTuning: 'ai',
  webhooks: 'integrations',
  elasticsearch: 'integrations',
  harbor: 'integrations',
  cache: 'infrastructure',
  portainerBackup: 'infrastructure',
  metricsRetention: 'infrastructure',
  edgeAgent: 'infrastructure',
};

// ─── Tab strip ───────────────────────────────────────────────────────

/**
 * Horizontally scrollable tab row with an honest overflow affordance.
 *
 * Seven tabs do not fit at tablet width. The row scrolled, but nothing said so —
 * no fade, no arrow, no cut-off glyph — so 2½ tabs were simply invisible. The
 * arrows appear only when there is something to scroll to, which in a
 * zero-layout environment (jsdom) means never.
 */
function TabStrip({ children }: { children: React.ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setOverflow({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const scrollBy = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({ left: direction * 200, behavior: 'smooth' });
  };

  return (
    <div className="relative border-b">
      <div
        ref={scrollerRef}
        onScroll={measure}
        className="flex items-center overflow-x-auto scrollbar-themed"
      >
        {children}
      </div>
      {overflow.left && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent"
          />
          <button
            type="button"
            aria-label="Scroll tabs left"
            onClick={() => scrollBy(-1)}
            className="absolute left-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-input bg-background text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      )}
      {overflow.right && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
          />
          <button
            type="button"
            aria-label="Scroll tabs right"
            onClick={() => scrollBy(1)}
            className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-input bg-background text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Guarded-change review bar ───────────────────────────────────────

interface GuardedChangesBarProps {
  keys: string[];
  editedValues: Record<string, string>;
  originalValues: Record<string, string>;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * Explicit save for the settings that auto-save must never touch.
 *
 * It is pinned to the viewport rather than the page header because the field
 * being edited can sit 2000px below it, and a confirmation the operator has to
 * scroll to find is not a confirmation. Secrets are reported as "new value
 * entered" — the review must not print a client secret back onto the screen.
 */
function GuardedChangesBar({
  keys,
  editedValues,
  originalValues,
  isSaving,
  onSave,
  onDiscard,
}: GuardedChangesBarProps) {
  if (keys.length === 0) return null;

  return (
    <div
      data-testid="guarded-changes-bar"
      role="region"
      aria-label="Settings awaiting review"
      className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-3xl rounded-lg border border-amber-500/50 bg-card p-4 shadow-lg sm:bottom-6"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">
            {keys.length === 1 ? '1 change needs review' : `${keys.length} changes need review`}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            These are not saved automatically. Nothing is applied until you save.
          </p>
          <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto scrollbar-themed pr-1">
            {keys.map((key) => {
              const setting = SETTING_BY_KEY[key];
              const isSecret = setting?.type === 'password';
              const before = originalValues[key] ?? '';
              const after = editedValues[key] ?? '';
              const shrinking = shrinksRetentionWindow(key, after, before);
              const consequence = settingConsequence(setting);
              const showConsequence = consequence && (shrinking || settingRisk(setting) === 'security');
              return (
                <li key={key} data-testid={`guarded-change-${key}`} className="text-sm">
                  <span className="font-medium">{setting?.label ?? key}</span>
                  <span className="text-muted-foreground">
                    {isSecret
                      ? ' — new value entered'
                      : ` — ${before === '' ? 'empty' : before} → ${after === '' ? 'empty' : after}`}
                  </span>
                  {showConsequence && (
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{consequence}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={isSaving}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {keys.length === 1 ? 'Save 1 change' : `Save ${keys.length} changes`}
        </button>
      </div>
    </div>
  );
}

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
  /**
   * The last server snapshot, readable inside the init effect without making it
   * depend on `originalValues` (which it also sets — that would re-enter). Used
   * to tell "the operator changed this" from "the server changed this".
   */
  const originalValuesRef = useRef<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  // Keys committed in the last few seconds, so each row can confirm at the row
  // instead of only in the page header the operator has scrolled away from.
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [searchQuery, setSearchQuery] = useState('');

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

      // Re-sync to the server, but never discard what the operator has typed.
      //
      // This effect runs on every change of the `['settings']` query data, and
      // `useUpdateSetting` changes that data on every save — optimistically in
      // `onMutate`, then again when `onSettled` invalidates. So it fires while
      // the page is in use, not only on first load. Overwriting wholesale meant
      // that auto-saving any ordinary knob silently threw away a *guarded* edit
      // queued on the same tab — the Security tab, where the guarded keys are
      // `oidc.client_secret` and `oidc.allow_insecure_transport`, and where the
      // GuardedChangesBar has just promised nothing is applied until you save.
      //
      // A key the operator has changed but not yet saved belongs to them; every
      // other key takes the server's value.
      setEditedValues((pending) => {
        const previousOriginal = originalValuesRef.current;
        const next = { ...values };
        for (const [key, value] of Object.entries(pending)) {
          if (value !== previousOriginal[key]) next[key] = value;
        }
        return next;
      });
      originalValuesRef.current = values;
      setOriginalValues(values);
      setSaveError(null);
    }
  }, [settingsData]);

  // The row-level "Saved" pill is a confirmation, not a status — it fades.
  useEffect(() => {
    if (savedKeys.size === 0) return;
    const timeout = window.setTimeout(() => setSavedKeys(new Set<string>()), 4000);
    return () => { window.clearTimeout(timeout); };
  }, [savedKeys]);

  // ── Change detection ─────────────────────────────────────────────

  const hasChanges = useMemo(
    () => Object.keys(editedValues).some((key) => editedValues[key] !== originalValues[key]),
    [editedValues, originalValues],
  );

  const restartKeys = useMemo(() => [
    'monitoring.polling_interval',
    'monitoring.enabled',
    'oidc.enabled',
    'oidc.issuer_url',
    'oidc.client_id',
    'oidc.client_secret',
    'notifications.teams_enabled',
    'notifications.teams_webhook_url',
    'notifications.email_enabled',
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
      // Keep the ref alongside the state: the init effect compares against it
      // to decide what is a pending operator edit, and a just-saved key is no
      // longer one.
      originalValuesRef.current = { ...originalValuesRef.current, ...appliedValues };
      setOriginalValues((prev) => ({ ...prev, ...appliedValues }));
      setSaveSuccess(true);
      setSavedKeys(new Set(Object.keys(appliedValues)));
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

  // ── Auto-save ───────────────────────────────────────────────────
  //
  // Auto-save is for cosmetics and tuning knobs, where the cost of a wrong value
  // is a cache miss. It deliberately excludes two classes: LLM keys (explicit
  // Save in the AI tab) and *guarded* keys — anything that changes who can sign
  // in or deletes stored history. A paused keystroke must not be able to publish
  // an unauthenticated status page or drop 83 days of metrics.

  const isAutoSaveKey = useCallback(
    (key: string) => !(LLM_SETTING_KEYS as readonly string[]).includes(key) && !isGuardedSetting(key),
    [],
  );

  useEffect(() => {
    const autoSaveChanged = Object.keys(editedValues).some(
      (key) => editedValues[key] !== originalValues[key] && isAutoSaveKey(key),
    );
    if (isSaving || !autoSaveChanged) return;

    const editedSnapshot = { ...editedValues };
    const originalSnapshot = { ...originalValues };
    const autoSaveKeys = Object.keys(editedSnapshot).filter(isAutoSaveKey);

    const timeout = window.setTimeout(() => {
      void saveChangedSettings(editedSnapshot, originalSnapshot, autoSaveKeys);
    }, 700);

    return () => { window.clearTimeout(timeout); };
  }, [editedValues, isAutoSaveKey, isSaving, originalValues, saveChangedSettings]);

  // ── Guarded settings: explicit, reviewed save ───────────────────

  const guardedPendingKeys = useMemo(
    () =>
      Object.keys(editedValues)
        .filter((key) => editedValues[key] !== originalValues[key] && isGuardedSetting(key))
        .sort(),
    [editedValues, originalValues],
  );

  const saveGuardedSettings = useCallback(async () => {
    if (guardedPendingKeys.length === 0) return;
    await saveChangedSettings({ ...editedValues }, { ...originalValues }, guardedPendingKeys);
  }, [editedValues, guardedPendingKeys, originalValues, saveChangedSettings]);

  const discardGuardedChanges = useCallback(() => {
    setEditedValues((prev) => {
      const next = { ...prev };
      for (const key of guardedPendingKeys) {
        next[key] = originalValues[key];
      }
      return next;
    });
  }, [guardedPendingKeys, originalValues]);

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
      if (resolved === DEFAULT_SETTINGS_TAB) {
        next.delete('tab');
      } else {
        next.set('tab', resolved);
      }
      return next;
    }, { replace: true });
  };

  // ── Search across every key ─────────────────────────────────────

  const searchMatches = useMemo(() => searchSettings(searchQuery), [searchQuery]);

  const goToSetting = (key: string) => {
    const tab = TAB_BY_CATEGORY[SETTING_CATEGORY_BY_KEY[key]];
    if (tab) handleTabChange(tab);
    setSearchQuery('');
    // The tab content mounts with that state update; wait a frame for the row.
    window.requestAnimationFrame(() => {
      const element = document.getElementById(settingDomId(key));
      element?.scrollIntoView({ block: 'center' });
      element?.focus?.();
    });
  };

  // ── Loading / Error states ───────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" subtitle={SETTINGS_SUBTITLE} />
        <div className="grid gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-6 shadow-sm">
              <SkeletonText lines={4} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" subtitle={SETTINGS_SUBTITLE} />
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
      <PageHeader
        title="Settings"
        subtitle={SETTINGS_SUBTITLE}
        actions={
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-9 w-48 rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring sm:w-56"
            />
          </div>
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
          {/* Mounted for the life of the tab. It used to render only while
              `hasChanges`, which a successful auto-save clears — so the undo
              control disappeared the moment a value committed. */}
          <button
            onClick={handleReset}
            disabled={isSaving || !hasChanges}
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Reset
          </button>
        </>
        }
      />

      {/* Search results — 107 keys across 7 tabs is not a list you scan. */}
      {searchQuery.trim().length >= 2 && (
        <div data-testid="settings-search-results" className="rounded-lg border bg-card">
          {searchMatches.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No setting matches “{searchQuery.trim()}”. Try a word from the setting’s label, such as
              “retention”, “OIDC” or “webhook”.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {searchMatches.map((match) => (
                <li key={match.key}>
                  <button
                    type="button"
                    onClick={() => goToSetting(match.key)}
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-accent"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{match.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {TAB_META.find((t) => t.value === TAB_BY_CATEGORY[match.category])?.label}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">{match.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Restart Warning */}
      {(changesRequireRestart || restartPending) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-500">Restart Required</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Some of these settings are read once at boot. Restart the backend
              service to apply them.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabStrip>
          <Tabs.List className="flex w-max items-center gap-1">
            {TAB_META.filter((t) => !t.adminOnly || role === 'admin').map((t) => (
              <Tabs.Trigger key={t.value} value={t.value} className={TAB_TRIGGER_CLASS}>
                {t.icon}
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </TabStrip>

        <SettingsSavedKeysProvider savedKeys={savedKeys}>
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
        </SettingsSavedKeysProvider>
      </Tabs.Root>

      <GuardedChangesBar
        keys={guardedPendingKeys}
        editedValues={editedValues}
        originalValues={originalValues}
        isSaving={isSaving}
        onSave={() => { void saveGuardedSettings(); }}
        onDiscard={discardGuardedChanges}
      />
    </div>
  );
}
