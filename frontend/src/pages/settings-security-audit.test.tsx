import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SecurityAuditSettingsSection } from './settings';

const mockMutateAsync = vi.fn();
const mockRefetch = vi.fn();
const ignoreListData = {
  key: 'security_audit_ignore_list',
  category: 'security',
  defaults: ['portainer', 'traefik'],
  patterns: ['portainer', 'infra-*'],
} as const;

vi.mock('@/hooks/use-security-audit', () => ({
  useSecurityIgnoreList: () => ({
    data: ignoreListData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
  }),
  useUpdateSecurityIgnoreList: () => ({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
    isPending: false,
  }),
}));

const mockSuccess = vi.fn();
const mockError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
    info: vi.fn(),
  },
}));

describe('SecurityAuditSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ success: true });
  });

  it('saves ignore list patterns', async () => {
    render(<SecurityAuditSettingsSection />);

    const textArea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textArea, { target: { value: 'portainer\ntraefik\ninfra-*' } });
    await waitFor(() => {
      expect(textArea.value).toBe('portainer\ntraefik\ninfra-*');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(['portainer', 'traefik', 'infra-*']);
      expect(mockSuccess).toHaveBeenCalled();
    });
  });

  it('resets editor to defaults', async () => {
    render(<SecurityAuditSettingsSection />);

    const textArea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textArea, { target: { value: 'custom-*' } });
    await waitFor(() => {
      expect(textArea.value).toBe('custom-*');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Defaults' }));

    await waitFor(() => {
      expect(textArea.value).toBe('portainer\ntraefik');
    });
  });
});
