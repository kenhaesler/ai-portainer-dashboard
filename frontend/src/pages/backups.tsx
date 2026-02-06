import { Loader2, Download, Trash2, RotateCcw, Database, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  downloadBackup,
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
} from '@/hooks/use-backups';
import { formatDate } from '@/lib/utils';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function BackupsPage() {
  const { data, isLoading, error, refetch, isFetching } = useBackups();
  const createBackup = useCreateBackup();
  const deleteBackup = useDeleteBackup();
  const restoreBackup = useRestoreBackup();

  const backups = data?.backups ?? [];

  const handleCreate = async () => {
    try {
      await createBackup.mutateAsync();
      toast.success('Backup created successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create backup');
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      await downloadBackup(filename);
      toast.success('Backup download started');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download backup');
    }
  };

  const handleDelete = async (filename: string) => {
    const confirmed = window.confirm(`Delete backup ${filename}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteBackup.mutateAsync(filename);
      toast.success('Backup deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete backup');
    }
  };

  const handleRestore = async (filename: string) => {
    const confirmed = window.confirm(
      `Restore from ${filename}? This replaces the active database. A restart is recommended afterwards.`
    );
    if (!confirmed) return;

    try {
      const result = await restoreBackup.mutateAsync(filename);
      toast.success(result.message ?? 'Backup restored. Please restart the application.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore backup');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backup Management</h1>
          <p className="text-muted-foreground">
            Create, download, restore, and delete database backups.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={createBackup.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {createBackup.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Database className="h-4 w-4" />
          )}
          Create Backup
        </button>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Restore is a destructive operation. Always verify the selected file and restart the application after a successful restore.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <p className="font-medium text-destructive">Failed to load backups</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Unexpected error'}
          </p>
          <button
            type="button"
            className="mt-3 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-base font-semibold">Available Backups</h2>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {isLoading ? (
            <div className="space-y-2 p-4">
              <div className="h-10 animate-pulse rounded bg-muted" />
              <div className="h-10 animate-pulse rounded bg-muted" />
              <div className="h-10 animate-pulse rounded bg-muted" />
            </div>
          ) : backups.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-base font-medium">No backups yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a backup to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Filename</th>
                    <th className="px-4 py-3 font-medium">Size</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => {
                    const deleting = deleteBackup.isPending && deleteBackup.variables === backup.filename;
                    const restoring = restoreBackup.isPending && restoreBackup.variables === backup.filename;
                    return (
                      <tr key={backup.filename} className="border-b last:border-0">
                        <td className="px-4 py-3 font-mono text-xs">{backup.filename}</td>
                        <td className="px-4 py-3">{formatBytes(backup.size)}</td>
                        <td className="px-4 py-3">{formatDate(backup.created)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleDownload(backup.filename)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                              title="Download backup"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRestore(backup.filename)}
                              disabled={restoring}
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                              title="Restore backup"
                            >
                              {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(backup.filename)}
                              disabled={deleting}
                              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
                              title="Delete backup"
                            >
                              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
