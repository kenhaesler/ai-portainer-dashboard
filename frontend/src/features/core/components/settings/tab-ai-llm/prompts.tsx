import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  History,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  useLlmModels,
  useLlmTestPrompt,
  type LlmModel,
  type LlmTestPromptResponse,
} from '@/features/ai-intelligence/hooks/use-llm-models';
import {
  usePromptProfiles,
  useCreateProfile,
  useDeleteProfile,
  useDuplicateProfile,
  useSwitchProfile,
  useExportProfile,
  useImportPreview,
  useImportApply,
  type PromptExportData,
  type ImportPreviewResponse,
} from '@/features/ai-intelligence/hooks/use-prompt-profiles';
import { useUpdateSetting, useDeleteSetting } from '@/features/core/hooks/use-settings';
import { usePromptHistory, useRollbackPrompt, type PromptVersion } from '@/features/ai-intelligence/hooks/use-prompt-versions';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { cn, formatBytes } from '@/shared/lib/utils';
import { formatRelativeTime as sharedFormatRelativeTime } from '@/shared/lib/format-relative-time';
import { api } from '@/shared/lib/api';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

// ─── AI Prompts Tab ─────────────────────────────────────────────────

interface PromptFeatureInfo {
  key: string;
  label: string;
  description: string;
  defaultPrompt: string;
  /** Profile-aware effective prompt (profile prompt or default) */
  effectivePrompt?: string;
}

function ProfileSelector({
  onProfileSwitch,
  onImportPreview,
}: {
  onProfileSwitch: () => void;
  onImportPreview: (data: PromptExportData, preview: ImportPreviewResponse) => void;
}) {
  const { data: profileData, isLoading } = usePromptProfiles();
  const createProfile = useCreateProfile();
  const deleteProfileMut = useDeleteProfile();
  const duplicateProfile = useDuplicateProfile();
  const switchProfileMut = useSwitchProfile();
  const exportProfile = useExportProfile();
  const importPreview = useImportPreview();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    exportProfile.mutate({ profileId: activeId });
  };

  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    if (file.size > 1024 * 1024) {
      setImportError('File too large (max 1 MB)');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PromptExportData;
      if (typeof parsed.version !== 'number' || typeof parsed.features !== 'object') {
        setImportError('Invalid file format: missing required fields');
        return;
      }
      const preview = await importPreview.mutateAsync(parsed);
      setImportError(null);
      onImportPreview(parsed, preview);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setImportError('Invalid JSON file');
      } else {
        setImportError(err instanceof Error ? err.message : 'Failed to parse import file');
      }
    }
  };

  const profiles = profileData?.profiles ?? [];
  const activeId = profileData?.activeProfileId ?? 'default';
  const activeProfile = profiles.find((p) => p.id === activeId);

  const handleSwitch = async (id: string) => {
    if (id === activeId) return;
    await switchProfileMut.mutateAsync({ id });
    onProfileSwitch();
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createProfile.mutateAsync({
      name: newName.trim(),
      description: newDescription.trim(),
      prompts: {},
    });
    setNewName('');
    setNewDescription('');
    setShowNewDialog(false);
  };

  const handleDuplicate = async () => {
    if (!newName.trim() || !activeProfile) return;
    await duplicateProfile.mutateAsync({
      sourceId: activeId,
      name: newName.trim(),
    });
    setNewName('');
    setShowDuplicateDialog(false);
  };

  const handleDelete = async () => {
    if (!activeProfile || activeProfile.isBuiltIn) return;
    await deleteProfileMut.mutateAsync({ id: activeId, name: activeProfile.name });
    setShowDeleteConfirm(false);
    onProfileSwitch();
  };

  if (isLoading) {
    return <div className="h-10 animate-pulse rounded bg-muted" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Active Profile:</span>
        </div>

        <ThemedSelect
          value={activeId}
          onValueChange={(val) => void handleSwitch(val)}
          options={profiles.map((p) => ({
            value: p.id,
            label: `${p.name}${p.isBuiltIn ? ' (built-in)' : ''}`,
          }))}
          className="min-w-[200px]"
        />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setNewName(''); setNewDescription(''); setShowNewDialog(true); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
          <button
            type="button"
            onClick={() => { setNewName(`${activeProfile?.name ?? 'Profile'} (Copy)`); setShowDuplicateDialog(true); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          {activeProfile && !activeProfile.isBuiltIn && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1 text-sm text-red-600 hover:text-red-500 border border-red-200 dark:border-red-900 rounded-md px-2.5 py-1.5 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}

          <span className="text-muted-foreground">|</span>

          <button
            type="button"
            onClick={handleExport}
            disabled={exportProfile.isPending}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exportProfile.isPending ? 'Exporting...' : 'Export'}
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importPreview.isPending}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {importPreview.isPending ? 'Reading...' : 'Import'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />
        </div>
      </div>

      {importError && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-500/5 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {activeProfile && (
        <p className="text-xs text-muted-foreground pl-6">
          {activeProfile.description || 'No description'}
        </p>
      )}

      {/* New Profile Dialog */}
      {showNewDialog && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Create New Profile</h4>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Custom Profile"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Description</label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Brief description of this profile's focus"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewDialog(false)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newName.trim() || createProfile.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createProfile.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Dialog */}
      {showDuplicateDialog && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Duplicate "{activeProfile?.name}"</h4>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">New Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Profile name"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDuplicateDialog(false)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDuplicate()}
              disabled={!newName.trim() || duplicateProfile.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {duplicateProfile.isPending ? 'Duplicating...' : 'Duplicate'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && activeProfile && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-500/5 p-4 space-y-3">
          <p className="text-sm">
            Are you sure you want to delete "<strong>{activeProfile.name}</strong>"? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleteProfileMut.isPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteProfileMut.isPending ? 'Deleting...' : 'Delete Profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function TokenBadge({ count }: { count: number }) {
  const color = count < 500 ? 'text-emerald-600 bg-emerald-500/10' : count < 1000 ? 'text-amber-600 bg-amber-500/10' : 'text-red-600 bg-red-500/10';
  return (
    <span className={cn('text-xs px-1.5 py-0.5 rounded font-mono', color)}>
      ~{count} tokens
    </span>
  );
}

// Exported for tests (accessible close-button name, #1540).
export function PromptTestPanel({
  feature,
  systemPrompt,
  model,
  temperature,
}: {
  feature: string;
  systemPrompt: string;
  model: string;
  temperature: string;
}) {
  const testPrompt = useLlmTestPrompt();
  const [result, setResult] = useState<LlmTestPromptResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleTest = () => {
    setIsOpen(true);
    setResult(null);
    testPrompt.mutate(
      {
        feature,
        systemPrompt,
        ...(model ? { model } : {}),
        ...(temperature ? { temperature: parseFloat(temperature) } : {}),
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (err) => setResult({ success: false, error: err.message }),
      },
    );
  };

  const handleCancel = () => {
    setIsOpen(false);
    setResult(null);
  };

  const isLoading = testPrompt.isPending;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleTest}
        disabled={isLoading}
        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {isLoading ? 'Testing...' : 'Test Prompt'}
      </button>

      {isOpen && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Test Results
            </span>
            <button
              type="button"
              onClick={handleCancel}
              aria-label="Close test results"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {result?.sampleInput && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Sample input: {result.sampleLabel}
              </p>
              <pre className="text-xs bg-background rounded border border-border p-2 overflow-x-auto max-h-24 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                {result.sampleInput.length > 300
                  ? result.sampleInput.slice(0, 300) + '...'
                  : result.sampleInput}
              </pre>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Waiting for LLM response...</span>
            </div>
          )}

          {result && !result.success && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-sm text-red-600 dark:text-red-400">
                {result.error || 'Unknown error'}
              </p>
              {result.latencyMs !== undefined && (
                <p className="text-xs text-muted-foreground mt-1">
                  Failed after {(result.latencyMs / 1000).toFixed(1)}s
                </p>
              )}
            </div>
          )}

          {result?.success && (
            <>
              <div>
                <p className="text-xs text-muted-foreground mb-1">LLM Response:</p>
                <pre className="text-sm bg-background rounded border border-border p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                  {result.format === 'json'
                    ? (() => {
                        try {
                          return JSON.stringify(JSON.parse(result.response!), null, 2);
                        } catch {
                          return result.response;
                        }
                      })()
                    : result.response}
                </pre>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-2">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {result.latencyMs !== undefined
                    ? result.latencyMs < 1000
                      ? `${result.latencyMs}ms`
                      : `${(result.latencyMs / 1000).toFixed(1)}s`
                    : '-'}
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {result.tokens?.total ?? 0} tokens
                </span>
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-xs font-mono',
                    result.format === 'json'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600',
                  )}
                >
                  {result.format === 'json' ? 'Valid JSON' : 'Plain Text'}
                </span>
                {result.model && (
                  <span className="text-xs text-muted-foreground">
                    Model: {result.model}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Exported for tests (accessible close-button name, #1540).
export function ImportPreviewPanel({
  preview,
  importData,
  features,
  onCancel,
  onApply,
  isApplying,
}: {
  preview: ImportPreviewResponse;
  importData: PromptExportData;
  features: PromptFeatureInfo[];
  onCancel: () => void;
  onApply: () => void;
  isApplying: boolean;
}) {
  const featureLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of features) map[f.key] = f.label;
    return map;
  }, [features]);

  const changedEntries = Object.entries(preview.changes).filter(([, c]) => c.status !== 'unchanged');
  const unchangedCount = Object.values(preview.changes).filter((c) => c.status === 'unchanged').length;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Import Preview
        </h4>
        <button type="button" onClick={onCancel} aria-label="Close import preview" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Importing from "<strong>{preview.profile}</strong>" ({preview.featureCount} feature{preview.featureCount !== 1 ? 's' : ''})
        {preview.exportedFrom && <> exported from {preview.exportedFrom}</>}
      </p>

      <div className="flex items-center gap-4 text-xs">
        {preview.summary.modified > 0 && (
          <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded">
            {preview.summary.modified} modified
          </span>
        )}
        {preview.summary.added > 0 && (
          <span className="bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">
            {preview.summary.added} added
          </span>
        )}
        {unchangedCount > 0 && (
          <span className="text-muted-foreground">
            {unchangedCount} unchanged
          </span>
        )}
      </div>

      {changedEntries.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {changedEntries.map(([key, change]) => (
            <div key={key} className="flex items-center gap-2 text-sm rounded px-2 py-1 bg-background/50">
              <span className={change.status === 'added' ? 'text-emerald-500' : 'text-amber-500'}>
                {change.status === 'added' ? '+' : '~'}
              </span>
              <span className="font-medium">{featureLabelMap[key] ?? key}</span>
              {change.status === 'modified' && change.tokenDelta !== undefined && change.tokenDelta !== 0 && (
                <span className="text-xs text-muted-foreground">
                  ({change.tokenDelta > 0 ? '+' : ''}{change.tokenDelta} tokens)
                </span>
              )}
              {change.after.model && (
                <span className="text-xs bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">
                  model: {change.after.model}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {changedEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">No changes to apply - all features already match.</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={isApplying || changedEntries.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isApplying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Importing...
            </>
          ) : (
            'Import & Apply'
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Prompt History Panel ────────────────────────────────────────────

/**
 * Computes a simple line-by-line diff between two prompt strings.
 * Returns arrays of added and removed lines relative to the previous version.
 */
function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  return {
    added: newLines.filter((l) => !oldSet.has(l) && l.trim() !== ''),
    removed: oldLines.filter((l) => !newSet.has(l) && l.trim() !== ''),
  };
}

// "just now" under two minutes, minutes/hours/days, then a locale date past 30 days.
function formatRelativeTime(isoString: string): string {
  return sharedFormatRelativeTime(isoString, {
    nowThresholdSeconds: 120,
    maxUnit: 'day',
    dateAfterDays: 30,
  });
}

interface PromptHistoryPanelProps {
  feature: string;
  featureLabel: string;
  onClose: () => void;
  onRollback: (prompt: string) => void;
}

function PromptHistoryPanel({ feature, featureLabel, onClose, onRollback }: PromptHistoryPanelProps) {
  const { data, isLoading, isError } = usePromptHistory(feature, true);
  const rollbackMutation = useRollbackPrompt(feature);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const versions = data?.versions ?? [];

  const handleRollback = (version: PromptVersion) => {
    rollbackMutation.mutate(version.id, {
      onSuccess: () => {
        // Also update the local draft in the parent via onRollback callback
        onRollback(version.systemPrompt);
        onClose();
      },
    });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{featureLabel} — Version History</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close history panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading history...</span>
        </div>
      )}

      {isError && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600 dark:text-red-400">
          Failed to load version history.
        </div>
      )}

      {!isLoading && !isError && versions.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No version history yet. Save a prompt to start tracking changes.
        </p>
      )}

      {!isLoading && versions.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {versions.map((version, index) => {
            const prevVersion = versions[index + 1];
            const diff = prevVersion
              ? computeDiff(prevVersion.systemPrompt, version.systemPrompt)
              : { added: version.systemPrompt.split('\n').filter((l) => l.trim()), removed: [] };
            const isExpanded = expandedId === version.id;
            const isCurrent = index === 0;

            return (
              <div
                key={version.id}
                className={cn(
                  'rounded-lg border bg-card',
                  isCurrent && 'border-primary/30 bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn(
                      'text-xs font-mono font-semibold shrink-0',
                      isCurrent ? 'text-primary' : 'text-muted-foreground',
                    )}>
                      v{version.version}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-medium shrink-0">
                        current
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 truncate">
                      <span className="truncate">{version.changedBy}</span>
                      <span>·</span>
                      <span className="shrink-0" title={new Date(version.changedAt).toLocaleString()}>
                        {formatRelativeTime(version.changedAt)}
                      </span>
                    </div>
                    {version.changeNote && (
                      <span className="text-xs text-muted-foreground italic truncate hidden sm:block">
                        {version.changeNote}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Diff summary badges */}
                    {diff.added.length > 0 && (
                      <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1 rounded">
                        +{diff.added.length}
                      </span>
                    )}
                    {diff.removed.length > 0 && (
                      <span className="text-[10px] font-mono bg-red-500/10 text-red-600 dark:text-red-400 px-1 rounded">
                        -{diff.removed.length}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : version.id)}
                      className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
                    >
                      {isExpanded ? 'Hide' : 'Diff'}
                    </button>
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRollback(version)}
                        disabled={rollbackMutation.isPending}
                        className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                      >
                        {rollbackMutation.isPending ? 'Rolling back...' : 'Rollback'}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-3 py-2.5 space-y-2">
                    {/* Show diff lines */}
                    {diff.added.length > 0 && (
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Added</p>
                        {diff.added.map((line, i) => (
                          <div key={i} className="flex gap-1.5 text-xs font-mono bg-emerald-500/5 rounded px-2 py-0.5">
                            <span className="text-emerald-600 dark:text-emerald-400 shrink-0">+</span>
                            <span className="text-foreground break-words min-w-0">{line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {diff.removed.length > 0 && (
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-medium text-red-600 dark:text-red-400 uppercase tracking-wide">Removed</p>
                        {diff.removed.map((line, i) => (
                          <div key={i} className="flex gap-1.5 text-xs font-mono bg-red-500/5 rounded px-2 py-0.5">
                            <span className="text-red-600 dark:text-red-400 shrink-0">-</span>
                            <span className="text-foreground/60 break-words min-w-0">{line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {diff.added.length === 0 && diff.removed.length === 0 && (
                      <p className="text-xs text-muted-foreground">No line-level changes detected.</p>
                    )}
                    {/* Full prompt text */}
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        View full prompt
                      </summary>
                      <pre className="mt-1.5 text-xs font-mono bg-background rounded border border-border p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                        {version.systemPrompt}
                      </pre>
                    </details>
                    {(version.model || version.temperature !== null) && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                        {version.model && <span>Model: <span className="font-mono">{version.model}</span></span>}
                        {version.temperature !== null && <span>Temp: {version.temperature}</span>}
                      </div>
                    )}
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

export function AiPromptsTab({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const [features, setFeatures] = useState<PromptFeatureInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const queryClient = useQueryClient();
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const updateSetting = useUpdateSetting();
  const deleteSetting = useDeleteSetting();
  const [keysToDelete, setKeysToDelete] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<{ data: PromptExportData; preview: ImportPreviewResponse } | null>(null);
  const importApply = useImportApply();

  const apiUrl = values['llm.api_url'] || '';
  const globalModel = values['llm.model'] || '';
  const { data: modelsData } = useLlmModels(apiUrl || undefined);
  const models: LlmModel[] = modelsData?.models ?? [];

  useEffect(() => {
    const loadFeatures = async () => {
      try {
        const data = await api.get<{ features: PromptFeatureInfo[] }>('/api/settings/prompt-features');
        setFeatures(data.features);
      } catch {
        setFeatures([]);
      } finally {
        setLoading(false);
      }
    };
    void loadFeatures();
  }, [profileRefreshKey]);

  const handleProfileSwitch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    setProfileRefreshKey((k) => k + 1);
  }, [queryClient]);

  useEffect(() => {
    if (features.length === 0) return;
    const drafts: Record<string, string> = {};
    for (const f of features) {
      const promptKey = `prompts.${f.key}.system_prompt`;
      const modelKey = `prompts.${f.key}.model`;
      const tempKey = `prompts.${f.key}.temperature`;
      // Use profile-aware effective prompt as fallback (includes profile's custom prompt)
      drafts[promptKey] = values[promptKey] || f.effectivePrompt || f.defaultPrompt;
      drafts[modelKey] = values[modelKey] || '';
      drafts[tempKey] = values[tempKey] || '';
    }
    setDraftValues(drafts);
    setSavedValues(drafts);
  }, [features, values]);

  const toggleFeature = (key: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedFeatures(new Set(features.map((f) => f.key)));
  };

  const collapseAll = () => {
    setExpandedFeatures(new Set());
  };

  const handleDraftChange = (key: string, value: string) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  const resetToDefault = (featureKey: string) => {
    const feature = features.find((f) => f.key === featureKey);
    if (!feature) return;
    const promptKey = `prompts.${featureKey}.system_prompt`;
    const modelKey = `prompts.${featureKey}.model`;
    const tempKey = `prompts.${featureKey}.temperature`;
    // Mark keys for deletion so profile fallback works correctly
    setKeysToDelete((prev) => new Set([...prev, promptKey, modelKey, tempKey]));
    setDraftValues((prev) => ({
      ...prev,
      [promptKey]: feature.effectivePrompt || feature.defaultPrompt,
      [modelKey]: '',
      [tempKey]: '',
    }));
    setSaveSuccess(false);
  };

  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(draftValues).some((k) => draftValues[k] !== savedValues[k]);
  }, [draftValues, savedValues]);

  const changedCount = useMemo(() => {
    return features.filter((f) => {
      const promptKey = `prompts.${f.key}.system_prompt`;
      return draftValues[promptKey] !== savedValues[promptKey];
    }).length;
  }, [draftValues, savedValues, features]);

  const isCustomized = (featureKey: string) => {
    const feature = features.find((f) => f.key === featureKey);
    if (!feature) return false;
    const promptKey = `prompts.${featureKey}.system_prompt`;
    const modelKey = `prompts.${featureKey}.model`;
    const tempKey = `prompts.${featureKey}.temperature`;
    const effectiveDefault = feature.effectivePrompt || feature.defaultPrompt;
    const storedPrompt = values[promptKey] || effectiveDefault;
    return storedPrompt !== effectiveDefault || (values[modelKey] || '') !== '' || (values[tempKey] || '') !== '';
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    const changedKeys = Object.keys(draftValues).filter((k) => draftValues[k] !== savedValues[k]);
    try {
      for (const key of changedKeys) {
        if (keysToDelete.has(key)) {
          // Delete the setting so profile fallback can take effect
          await deleteSetting.mutateAsync({ key, showToast: false });
          onChange(key, '');
        } else {
          await updateSetting.mutateAsync({
            key,
            value: draftValues[key],
            category: 'prompts',
            showToast: false,
          });
          onChange(key, draftValues[key]);
        }
      }
      setSavedValues({ ...draftValues });
      setKeysToDelete(new Set());
      setSaveSuccess(true);
      toast.success(`Saved ${changedKeys.length} prompt setting${changedKeys.length !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraftValues({ ...savedValues });
    setKeysToDelete(new Set());
    setSaveSuccess(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProfileSelector
        onProfileSwitch={handleProfileSwitch}
        onImportPreview={(data, preview) => setImportPreviewData({ data, preview })}
      />

      {importPreviewData && (
        <ImportPreviewPanel
          preview={importPreviewData.preview}
          importData={importPreviewData.data}
          features={features}
          onCancel={() => setImportPreviewData(null)}
          onApply={() => {
            importApply.mutate(importPreviewData.data, {
              onSuccess: () => {
                setImportPreviewData(null);
                handleProfileSwitch();
              },
            });
          }}
          isApplying={importApply.isPending}
        />
      )}

      <div className="border-t border-border" />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Customize the system prompt, model, and temperature for each AI-powered feature.
            Changes only take effect when you click Save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Expand All
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Collapse All
          </button>
        </div>
      </div>

      {features.map((feature) => {
        const isExpanded = expandedFeatures.has(feature.key);
        const promptKey = `prompts.${feature.key}.system_prompt`;
        const modelKey = `prompts.${feature.key}.model`;
        const tempKey = `prompts.${feature.key}.temperature`;
        const promptValue = draftValues[promptKey] || feature.defaultPrompt;
        const modelValue = draftValues[modelKey] || '';
        const tempValue = draftValues[tempKey] || '';
        const tokenCount = estimateTokens(promptValue);
        const customized = isCustomized(feature.key);
        const hasLocalChanges = draftValues[promptKey] !== savedValues[promptKey]
          || draftValues[modelKey] !== savedValues[modelKey]
          || draftValues[tempKey] !== savedValues[tempKey];

        return (
          <div key={feature.key} className="rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => toggleFeature(feature.key)}
              className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <MessageSquare className="h-4 w-4" />
                <span className="font-medium">{feature.label}</span>
                {customized && (
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    customized
                  </span>
                )}
                {hasLocalChanges && (
                  <span className="text-xs bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded">
                    unsaved
                  </span>
                )}
              </div>
              <TokenBadge count={tokenCount} />
            </button>

            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4">
                <p className="text-sm text-muted-foreground">{feature.description}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Model Override</label>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Leave empty to use global default ({globalModel})
                    </p>
                    {models.length > 0 ? (
                      <ThemedSelect
                        value={modelValue || '__global_default__'}
                        onValueChange={(val) => handleDraftChange(modelKey, val === '__global_default__' ? '' : val)}
                        options={[
                          { value: '__global_default__', label: 'Use Global Default' },
                          ...models.map((m) => ({
                            value: m.name,
                            label: `${m.name}${m.size ? ` (${formatBytes(m.size)})` : ''}`,
                          })),
                        ]}
                        className="w-full"
                      />
                    ) : (
                      <input
                        type="text"
                        value={modelValue}
                        onChange={(e) => handleDraftChange(modelKey, e.target.value)}
                        placeholder="Use Global Default"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Temperature Override</label>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Leave empty to use global default
                    </p>
                    <input
                      type="number"
                      value={tempValue}
                      onChange={(e) => handleDraftChange(tempKey, e.target.value)}
                      placeholder="Use Global Default"
                      min={0}
                      max={2}
                      step={0.1}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium">System Prompt</label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => resetToDefault(feature.key)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset to Default
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowHistoryFor(showHistoryFor === feature.key ? null : feature.key)}
                        className={cn(
                          'flex items-center gap-1.5 text-xs transition-colors',
                          showHistoryFor === feature.key
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <History className="h-3 w-3" />
                        History
                      </button>
                      <TokenBadge count={tokenCount} />
                    </div>
                  </div>
                  <textarea
                    value={promptValue}
                    onChange={(e) => handleDraftChange(promptKey, e.target.value)}
                    className="min-h-[160px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Enter system prompt..."
                  />
                </div>

                <PromptTestPanel
                  feature={feature.key}
                  systemPrompt={promptValue}
                  model={modelValue}
                  temperature={tempValue}
                />

                {showHistoryFor === feature.key && (
                  <PromptHistoryPanel
                    feature={feature.key}
                    featureLabel={feature.label}
                    onClose={() => setShowHistoryFor(null)}
                    onRollback={(prompt) => handleDraftChange(promptKey, prompt)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Save Bar */}
      {(hasUnsavedChanges || saveSuccess) && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2">
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Info className="h-4 w-4 text-amber-500" />
              )}
              <span className="text-sm">
                {isSaving
                  ? 'Saving...'
                  : saveSuccess
                    ? 'All changes saved'
                    : `${changedCount} feature${changedCount !== 1 ? 's' : ''} modified`}
              </span>
            </div>
            {hasUnsavedChanges && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={isSaving}
                  className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save & Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
