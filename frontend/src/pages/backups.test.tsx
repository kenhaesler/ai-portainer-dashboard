import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreateMutateAsync = vi.fn();
const mockDeleteMutateAsync = vi.fn();
const mockRestoreMutateAsync = vi.fn();
const mockDownloadBackup = vi.fn();

const mockUseBackups = vi.fn();

vi.mock('@/hooks/use-backups', () => ({
  useBackups: () => mockUseBackups(),
  useCreateBackup: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useDeleteBackup: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
    variables: null,
  }),
  useRestoreBackup: () => ({
    mutateAsync: mockRestoreMutateAsync,
    isPending: false,
    variables: null,
  }),
  downloadBackup: (...args: unknown[]) => mockDownloadBackup(...args),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import BackupsPage from './backups';

describe('BackupsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    mockUseBackups.mockReturnValue({
      data: {
        backups: [
          {
            filename: 'backup-1.db',
            size: 1024,
            created: '2026-02-06T12:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
  });

  it('creates a backup from the header action', async () => {
    mockCreateMutateAsync.mockResolvedValue({ success: true });

    render(<BackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockToastSuccess).toHaveBeenCalledWith('Backup created successfully');
    });
  });

  it('restores a backup after explicit confirmation', async () => {
    mockRestoreMutateAsync.mockResolvedValue({ success: true, message: 'Backup restored. Please restart the application.' });

    render(<BackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalled();
      expect(mockRestoreMutateAsync).toHaveBeenCalledWith('backup-1.db');
      expect(mockToastSuccess).toHaveBeenCalledWith('Backup restored. Please restart the application.');
    });
  });

  it('deletes a backup after explicit confirmation', async () => {
    mockDeleteMutateAsync.mockResolvedValue({ success: true });

    render(<BackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalled();
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('backup-1.db');
      expect(mockToastSuccess).toHaveBeenCalledWith('Backup deleted');
    });
  });
});
