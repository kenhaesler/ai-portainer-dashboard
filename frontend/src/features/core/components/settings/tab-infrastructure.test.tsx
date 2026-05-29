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

import { PortainerBackupManagement } from './tab-infrastructure';

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

  it('triggers delete for the correct file from a row action', () => {
    render(<PortainerBackupManagement />);

    const secondRow = screen.getByText('portainer-backup-2026-05-02.tar.gz').closest('tr')!;
    fireEvent.click(within(secondRow).getByText('Delete'));

    expect(deleteMutate).toHaveBeenCalledWith('portainer-backup-2026-05-02.tar.gz', expect.any(Object));
  });

  it('refreshes the backup list when Refresh is clicked', async () => {
    render(<PortainerBackupManagement />);

    fireEvent.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });
});
