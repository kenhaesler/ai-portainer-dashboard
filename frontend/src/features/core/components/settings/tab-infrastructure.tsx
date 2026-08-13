import { useCallback, useMemo, useState } from 'react';
import {
  Archive,
  BarChart3,
  Clock,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDriveDownload,
  Info,
  Loader2,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { SettingsSection, DEFAULT_SETTINGS, type SettingsTabProps } from './shared';
import { useCacheClear } from '@/features/core/hooks/use-cache-admin';
import {
  usePortainerBackups,
  useCreatePortainerBackup,
  useDeletePortainerBackup,
  downloadPortainerBackup,
  type PortainerBackupFile,
} from '@/features/core/hooks/use-portainer-backups';
import { DataTable, type ColumnDef } from '@/shared/components/tables/data-table';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';
import { formatBytes } from '@/shared/lib/utils';
import { toast } from 'sonner';

export function InfrastructureTab({ editedValues, originalValues, onChange, isSaving }: SettingsTabProps) {
  const cacheClear = useCacheClear();

  return (
    <div className="space-y-6">
      {/* Cache Settings — the cache administration action lives with the cache
          settings rather than on the tab an admin happens to land on. */}
      <SettingsSection
        title="Cache"
        icon={<Database className="h-5 w-5" />}
        category="cache"
        settings={DEFAULT_SETTINGS.cache}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving}
        footerContent={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Clearing drops every cached Portainer response. The next page load refetches from
              Portainer directly, so expect one slower round of requests.
            </p>
            <button
              type="button"
              onClick={() => cacheClear.mutate()}
              disabled={cacheClear.isPending}
              className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {cacheClear.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Clear All Cache
            </button>
          </div>
        }
      />

      {/* Backup Schedule Settings */}
      <SettingsSection
        title="Backup Schedule"
        icon={<Clock className="h-5 w-5" />}
        category="portainerBackup"
        settings={DEFAULT_SETTINGS.portainerBackup}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        requiresRestart
        disabled={isSaving}
        status={editedValues['portainer_backup.enabled'] === 'true' ? 'configured' : 'not-configured'}
        statusLabel={editedValues['portainer_backup.enabled'] === 'true' ? 'Enabled' : 'Disabled'}
      />

      {/* Metrics Retention — moved from env vars to Settings DB (#993) */}
      <SettingsSection
        title="Metrics Retention"
        icon={<BarChart3 className="h-5 w-5" />}
        category="metricsRetention"
        settings={DEFAULT_SETTINGS.metricsRetention}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving}
      />

      {/* Edge Agent — how this dashboard polls the fleet, which is
          infrastructure, not a third-party integration. */}
      <SettingsSection
        title="Edge Agent"
        icon={<Wifi className="h-5 w-5" />}
        category="edgeAgent"
        settings={DEFAULT_SETTINGS.edgeAgent}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving}
      />

      {/* Backup Management */}
      <PortainerBackupManagement />
    </div>
  );
}

export function PortainerBackupManagement() {
  const { data, isLoading, refetch } = usePortainerBackups();
  const createBackup = useCreatePortainerBackup();
  const deleteBackupMut = useDeletePortainerBackup();
  const [manualPassword, setManualPassword] = useState('');
  const [showManualPassword, setShowManualPassword] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  // Deletion is permanent and there is no restore path from this screen, so the
  // click only ever opens a confirmation naming the exact archive (#backup-delete-confirm).
  const [pendingDelete, setPendingDelete] = useState<PortainerBackupFile | null>(null);

  const backups = data?.backups ?? [];

  const handleCreate = () => {
    createBackup.mutate(manualPassword || undefined, {
      onSuccess: (result) => {
        toast.success(`Portainer backup created: ${result.filename}`);
        setManualPassword('');
      },
      onError: (err) => {
        toast.error(`Backup failed: ${err.message}`);
      },
    });
  };

  const handleDownload = useCallback(async (filename: string) => {
    try {
      await downloadPortainerBackup(filename);
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, []);

  const requestDelete = useCallback((backup: PortainerBackupFile) => {
    setPendingDelete(backup);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const filename = pendingDelete.filename;
    setPendingDelete(null);
    setDeletingFile(filename);
    deleteBackupMut.mutate(filename, {
      onSuccess: () => {
        toast.success(`Deleted ${filename}`);
        setDeletingFile(null);
      },
      onError: (err) => {
        toast.error(`Delete failed: ${err.message}`);
        setDeletingFile(null);
      },
    });
  }, [deleteBackupMut, pendingDelete]);

  const columns = useMemo<ColumnDef<PortainerBackupFile, unknown>[]>(
    () => [
      {
        accessorKey: 'filename',
        header: 'Filename',
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'size',
        header: 'Size',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatBytes(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {new Date(getValue<string>()).toLocaleString()}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="block text-right">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const backup = row.original;
          return (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => handleDownload(backup.filename)}
                className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                onClick={() => requestDelete(backup)}
                disabled={deletingFile === backup.filename}
                className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                title={`Delete ${backup.filename}`}
              >
                {deletingFile === backup.filename ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete
              </button>
            </div>
          );
        },
      },
    ],
    [handleDownload, requestDelete, deletingFile],
  );

  return (
    <div className="space-y-6">
      {/* Manual Backup */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Create Backup</h2>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Create a manual backup of your Portainer server configuration. This calls the Portainer API and saves the resulting archive locally.
          </p>
          {/* An operator must not discover the missing restore path during an outage. */}
          <div
            data-testid="backup-recovery-note"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">This dashboard cannot restore a backup.</p>
              <p className="text-muted-foreground">
                Recovery is a Portainer operation: download the archive, then load it from a Portainer
                instance&apos;s &quot;Restore from backup&quot; screen. Archives are written to the
                dashboard&apos;s backup directory on this host — keep a copy elsewhere, or a host loss
                takes the backups with it.
              </p>
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-sm">
              <label htmlFor="manual-backup-password" className="text-sm font-medium mb-1 block">
                Password (optional)
              </label>
              <div className="relative">
                <input
                  id="manual-backup-password"
                  type={showManualPassword ? 'text' : 'password'}
                  value={manualPassword}
                  onChange={(e) => setManualPassword(e.target.value)}
                  placeholder="Encryption password"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowManualPassword(!showManualPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showManualPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button
              onClick={handleCreate}
              disabled={createBackup.isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createBackup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HardDriveDownload className="h-4 w-4" />
              )}
              Create Backup
            </button>
          </div>
        </div>
      </div>

      {/* Backup List */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Backup Files</h2>
            <span className="text-sm text-muted-foreground">({backups.length})</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        ) : backups.length === 0 ? (
          <div className="p-8 text-center">
            <Archive className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm font-medium">No Portainer backups yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a manual backup above or enable scheduled backups.
            </p>
          </div>
        ) : (
          <div className="p-4">
            <DataTable columns={columns} data={backups} hideSearch />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        title="Delete this backup?"
        description={
          pendingDelete
            ? `${pendingDelete.filename}, created ${new Date(pendingDelete.createdAt).toLocaleString()}. ` +
              'The archive is removed from this host and cannot be recovered from Portainer. ' +
              'Download it first if you are not certain.'
            : ''
        }
        confirmLabel="Delete backup"
        variant="danger"
        data-testid="confirm-delete-backup"
      />
    </div>
  );
}
