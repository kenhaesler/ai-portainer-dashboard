import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SocketProvider } from './socket-provider';

const mockUseAuth = vi.fn(() => ({ token: 'token-1', isAuthenticated: true }));
const mockUseUiStore = vi.fn((selector: (state: { potatoMode: boolean }) => boolean) =>
  selector({ potatoMode: false }),
);
const mockDisconnectAll = vi.fn();
const mockGetNamespaceSocket = vi.fn((namespace: string) => createMockSocket(namespace));

function createMockSocket(namespace: string) {
  return {
    namespace,
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
}

vi.mock('./auth-provider', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (state: { potatoMode: boolean }) => boolean) => mockUseUiStore(selector),
}));

vi.mock('@/lib/socket', () => ({
  getNamespaceSocket: (namespace: string, token: string) => mockGetNamespaceSocket(namespace, token),
  disconnectAll: () => mockDisconnectAll(),
}));

describe('SocketProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connects all namespaces when potato mode is disabled', async () => {
    render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>,
    );

    await waitFor(() => {
      expect(mockGetNamespaceSocket).toHaveBeenCalledTimes(3);
    });

    expect(mockGetNamespaceSocket).toHaveBeenCalledWith('llm', 'token-1');
    expect(mockGetNamespaceSocket).toHaveBeenCalledWith('monitoring', 'token-1');
    expect(mockGetNamespaceSocket).toHaveBeenCalledWith('remediation', 'token-1');
  });

  it('keeps only monitoring socket in potato mode', async () => {
    mockUseUiStore.mockImplementation((selector: (state: { potatoMode: boolean }) => boolean) =>
      selector({ potatoMode: true }),
    );

    render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>,
    );

    await waitFor(() => {
      expect(mockGetNamespaceSocket).toHaveBeenCalledTimes(1);
    });

    expect(mockGetNamespaceSocket).toHaveBeenCalledWith('monitoring', 'token-1');
    expect(mockGetNamespaceSocket).not.toHaveBeenCalledWith('llm', 'token-1');
    expect(mockGetNamespaceSocket).not.toHaveBeenCalledWith('remediation', 'token-1');
  });
});
