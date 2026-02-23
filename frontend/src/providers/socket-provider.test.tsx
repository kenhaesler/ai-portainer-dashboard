import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
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
  beforeEach(() => {
    // Reset to default implementations before each test so that
    // a mockImplementation in one test doesn't leak into the next.
    mockUseAuth.mockReturnValue({ token: 'token-1', isAuthenticated: true });
    mockUseUiStore.mockImplementation((selector: (state: { potatoMode: boolean }) => boolean) =>
      selector({ potatoMode: false }),
    );
    mockGetNamespaceSocket.mockImplementation((namespace: string) => createMockSocket(namespace));
  });

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

  it('does not disconnect sockets when effect re-runs (no thrashing)', async () => {
    // Simulate the provider re-rendering (e.g., potato mode toggle).
    // Sockets should NOT be disconnected — only event listeners should change.
    const { rerender } = render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>,
    );

    await waitFor(() => {
      expect(mockGetNamespaceSocket).toHaveBeenCalledTimes(3);
    });

    const createdSockets = mockGetNamespaceSocket.mock.results.map((r) => r.value);

    // Re-render with same props (simulates token refresh or minor state change)
    await act(async () => {
      rerender(
        <SocketProvider>
          <div>child</div>
        </SocketProvider>,
      );
    });

    // No socket should have been explicitly disconnected
    for (const socket of createdSockets) {
      expect(socket.disconnect).not.toHaveBeenCalled();
    }
  });

  it('calls disconnectAll on logout', async () => {
    const { rerender } = render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>,
    );

    await waitFor(() => {
      expect(mockGetNamespaceSocket).toHaveBeenCalled();
    });

    // Simulate logout
    mockUseAuth.mockReturnValue({ token: null as unknown as string, isAuthenticated: false });

    await act(async () => {
      rerender(
        <SocketProvider>
          <div>child</div>
        </SocketProvider>,
      );
    });

    expect(mockDisconnectAll).toHaveBeenCalled();
  });
});
