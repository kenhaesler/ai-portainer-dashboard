import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Mock the backup hooks so the component can render without a real query client / network
const refetch = vi.fn();
const createMutate = vi.fn();
const deleteMutate = vi.fn();
const downloadPortainerBackup = vi.fn();

let mockBackups: { filename: string; size: number; createdAt: string }[] = [];
let mockIsLoading = false;
let mockDeletePending = false;

vi.mock('@/features/core/hooks/use-portainer-backups', () => ({
  usePortainerBackups: () => ({ data: { backups: mockBackups }, isLoading: mockIsLoading, refetch }),
  useCreatePortainerBackup: () => ({ mutate: createMutate, isPending: false }),
  useDeletePortainerBackup: () => ({ mutate: deleteMutate, isPending: mockDeletePending }),
  downloadPortainerBackup: (filename: string) => downloadPortainerBackup(filename),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const cacheClearMutate = vi.fn();
vi.mock('@/features/core/hooks/use-cache-admin', () => ({
  useCacheClear: () => ({ mutate: cacheClearMutate, isPending: false }),
}));

import { InfrastructureTab, PortainerBackupManagement } from './tab-infrastructure';
import { DEFAULT_SETTINGS } from './shared';

const sampleBackups = [
  { filename: 'portainer-backup-2026-05-01.tar.gz', size: 1024 * 1024, createdAt: '2026-05-01T10:00:00Z' },
  { filename: 'portainer-backup-2026-05-02.tar.gz', size: 2 * 1024 * 1024, createdAt: '2026-05-02T10:00:00Z' },
];

describe('PortainerBackupManagement (DataTable migration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackups = [...sampleBackups];
    mockIsLoading = false;
    mockDeletePending = false;
  });

  it('renders the shared DataTable with backup rows', () => {
    render(<PortainerBackupManagement />);

    // The shared DataTable root marker confirms the migration
    expect(screen.getByTestId('data-table')).toBeInTheDocument();

    // Column headers preserved
    expect(screen.getByText('Filename')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();

    // Each backup is rendered with its formatted size
    expect(screen.getByText('portainer-backup-2026-05-01.tar.gz')).toBeInTheDocument();
    expect(screen.getByText('portainer-backup-2026-05-02.tar.gz')).toBeInTheDocument();
    expect(screen.getByText('1 MB')).toBeInTheDocument();
    expect(screen.getByText('2 MB')).toBeInTheDocument();
  });

  it('does not render the DataTable when there are no backups (empty state preserved)', () => {
    mockBackups = [];
    render(<PortainerBackupManagement />);

    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
    expect(screen.getByText('No Portainer backups yet')).toBeInTheDocument();
  });

  it('triggers download for the correct file from a row action', () => {
    render(<PortainerBackupManagement />);

    const firstRow = screen.getByText('portainer-backup-2026-05-01.tar.gz').closest('tr')!;
    fireEvent.click(within(firstRow).getByText('Download'));

    expect(downloadPortainerBackup).toHaveBeenCalledWith('portainer-backup-2026-05-01.tar.gz');
  });

  it('does not delete on the row click alone — it opens a confirmation first', () => {
    render(<PortainerBackupManagement />);

    const secondRow = screen.getByText('portainer-backup-2026-05-02.tar.gz').closest('tr')!;
    fireEvent.click(within(secondRow).getByText('Delete'));

    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-delete-backup')).toBeInTheDocument();
  });

  it('names the file and its creation date in the delete confirmation', () => {
    render(<PortainerBackupManagement />);

    const secondRow = screen.getByText('portainer-backup-2026-05-02.tar.gz').closest('tr')!;
    fireEvent.click(within(secondRow).getByText('Delete'));

    const dialog = screen.getByTestId('confirm-delete-backup');
    expect(dialog).toHaveTextContent('portainer-backup-2026-05-02.tar.gz');
    expect(dialog).toHaveTextContent(new Date('2026-05-02T10:00:00Z').toLocaleString());
    expect(dialog).toHaveTextContent(/cannot be recovered/i);
  });

  it('deletes the confirmed file only after the confirm button is pressed', () => {
    render(<PortainerBackupManagement />);

    const secondRow = screen.getByText('portainer-backup-2026-05-02.tar.gz').closest('tr')!;
    fireEvent.click(within(secondRow).getByText('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }));

    expect(deleteMutate).toHaveBeenCalledWith('portainer-backup-2026-05-02.tar.gz', expect.any(Object));
  });

  it('cancelling the confirmation deletes nothing', () => {
    render(<PortainerBackupManagement />);

    const firstRow = screen.getByText('portainer-backup-2026-05-01.tar.gz').closest('tr')!;
    fireEvent.click(within(firstRow).getByText('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-delete-backup')).not.toBeInTheDocument();
  });

  it('states that restore is not available here and names the recovery path', () => {
    render(<PortainerBackupManagement />);

    const note = screen.getByTestId('backup-recovery-note');
    expect(note).toHaveTextContent(/cannot restore a backup/i);
    expect(note).toHaveTextContent(/Restore from backup/i);
    expect(note).toHaveTextContent(/keep a copy elsewhere/i);
  });

  it('refreshes the backup list when Refresh is clicked', async () => {
    render(<PortainerBackupManagement />);

    fireEvent.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });
});

describe('InfrastructureTab', () => {
  function renderTab() {
    const values: Record<string, string> = {};
    Object.values(DEFAULT_SETTINGS).flat().forEach((s) => { values[s.key] = s.defaultValue; });
    return render(
      <InfrastructureTab
        editedValues={values}
        originalValues={values}
        onChange={vi.fn()}
        isSaving={false}
      />,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockBackups = [...sampleBackups];
    mockIsLoading = false;
  });

  it('puts cache administration with the cache settings', () => {
    renderTab();

    const clear = screen.getByRole('button', { name: /clear all cache/i });
    fireEvent.click(clear);
    expect(cacheClearMutate).toHaveBeenCalled();
  });

  it('does not badge Cache or Metrics Retention as "Configured" — they have no other state', () => {
    renderTab();

    expect(screen.queryByText('Configured')).not.toBeInTheDocument();
  });

  it('marks every retention window as data-destroying', () => {
    renderTab();

    for (const setting of DEFAULT_SETTINGS.metricsRetention) {
      const row = screen.getByTestId(`setting-row-${setting.key}`);
      expect(row).toHaveAttribute('data-risk', 'destructive');
    }
  });

  it('hosts Edge Agent polling, which is infrastructure rather than an integration', () => {
    renderTab();

    expect(screen.getByText('Edge Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Live Container Data')).toBeInTheDocument();
  });

  it('does not mark cache TTLs, which cost a cache miss and nothing else', () => {
    renderTab();

    for (const setting of DEFAULT_SETTINGS.cache) {
      expect(screen.getByTestId(`setting-row-${setting.key}`)).not.toHaveAttribute('data-risk');
    }
  });
});
