import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SecurityAuditSettingsSection } from './settings';

const mockMutateAsync = vi.fn();
const mockRefetch = vi.fn();
const ignoreListData = {
  key: 'security_audit_ignore_list',
  category: 'security',
  defaults: ['portainer', 'traefik'],
  patterns: ['portainer', 'infra-*'],
} as const;

// Stable reference so the useEffect dependency array doesn't re-trigger every render
const stableMutationResult = {
  mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
  isPending: false,
};

vi.mock('@/features/security/hooks/use-security-audit', () => ({
  useSecurityIgnoreList: () => ({
    data: ignoreListData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
  }),
  useUpdateSecurityIgnoreList: () => stableMutationResult,
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
    vi.useFakeTimers();
    mockMutateAsync.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-saves ignore list patterns after edit', async () => {
    render(<SecurityAuditSettingsSection />);

    const textArea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textArea, { target: { value: 'portainer\ntraefik\ninfra-*' } });
    expect(textArea.value).toBe('portainer\ntraefik\ninfra-*');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(['portainer', 'traefik', 'infra-*']);
    expect(mockSuccess).toHaveBeenCalled();
  });

  it('resets editor to defaults and auto-saves', async () => {
    render(<SecurityAuditSettingsSection />);

    const textArea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textArea, { target: { value: 'custom-*' } });
    expect(textArea.value).toBe('custom-*');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Defaults' }));

    expect(textArea.value).toBe('portainer\ntraefik');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(['portainer', 'traefik']);
  });
});
