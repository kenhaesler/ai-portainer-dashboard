import { useState } from 'react';
import {
  Archive,
  Clock,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { SettingsSection, DEFAULT_SETTINGS, type SettingsTabProps } from './shared';
import {
  usePortainerBackups,
  useCreatePortainerBackup,
  useDeletePortainerBackup,
  downloadPortainerBackup,
} from '@/hooks/use-portainer-backups';
import { formatBytes } from '@/lib/utils';
import { toast } from 'sonner';

export function InfrastructureTab({ editedValues, originalValues, onChange, isSaving }: SettingsTabProps) {
  return (
    <div className="space-y-6">
      {/* Cache Settings */}
      <SettingsSection
        title="Cache"
        icon={<Database className="h-5 w-5" />}
        category="cache"
        settings={DEFAULT_SETTINGS.cache}
        values={editedValues}
        originalValues={originalValues}
        onChange={onChange}
        disabled={isSaving}
        status="configured"
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

      {/* Backup Management */}
      <PortainerBackupManagement />
    </div>
  );
}

function PortainerBackupManagement() {
  const { data, isLoading, refetch } = usePortainerBackups();
  const createBackup = useCreatePortainerBackup();
  const deleteBackupMut = useDeletePortainerBackup();
  const [manualPassword, setManualPassword] = useState('');
  const [showManualPassword, setShowManualPassword] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

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

  const handleDownload = async (filename: string) => {
    try {
      await downloadPortainerBackup(filename);
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDelete = (filename: string) => {
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
  };

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Filename</th>
                  <th className="px-4 py-2.5 font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.filename} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{backup.filename}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatBytes(backup.size)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
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
                          onClick={() => handleDelete(backup.filename)}
                          disabled={deletingFile === backup.filename}
                          className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingFile === backup.filename ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
