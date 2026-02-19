import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './login';

const mockNavigate = vi.fn();
const mockLogin = vi.fn();
const mockUseAuth = vi.fn();
const mockUseOIDCStatus = vi.fn();
const mockPrefetchQuery = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ prefetchQuery: mockPrefetchQuery }),
  };
});

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/use-oidc', () => ({
  useOIDCStatus: () => mockUseOIDCStatus(),
}));

function stubMatchMedia(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    mockPrefetchQuery.mockResolvedValue(undefined);

    mockUseAuth.mockReturnValue({
      login: mockLogin,
      isAuthenticated: false,
    });

    mockUseOIDCStatus.mockReturnValue({ data: { enabled: false, authUrl: null } });
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders cinematic login elements', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('login-gradient')).toBeInTheDocument();
    expect(screen.getByText(/Powered by AI/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('admin');
    expect(screen.getByLabelText('Password')).toHaveValue('changeme123');
    expect(document.querySelectorAll('.login-particle')).toHaveLength(10);
    expect(screen.getByRole('img', { name: 'Brain logo' })).toBeInTheDocument();
  });

  it('respects reduced motion by disabling decorative particles', () => {
    stubMatchMedia(true);

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(document.querySelectorAll('.login-particle')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows loading state and delays navigation for success animation', async () => {
    mockLogin.mockResolvedValue({ defaultLandingPage: '/ai-monitor' });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'changeme123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Signing in...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Signed in')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ai-monitor', { replace: true });
    }, { timeout: 1200 });
  });

  it('prefetches dashboard data immediately after login succeeds', async () => {
    mockLogin.mockResolvedValue({ defaultLandingPage: '/' });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'changeme123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Signed in')).toBeInTheDocument();
    });

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['dashboard', 'full', 8],
        staleTime: 60_000,
      }),
    );

    expect(mockPrefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['dashboard', 'kpi-history', 24],
        staleTime: 5 * 60_000,
      }),
    );
  });

  it('navigates after minimum animation time AND prefetch both complete', async () => {
    vi.useFakeTimers();

    let resolvePrefetch!: () => void;
    mockPrefetchQuery.mockReturnValue(new Promise<void>((r) => { resolvePrefetch = r; }));
    mockLogin.mockResolvedValue({ defaultLandingPage: '/dashboard' });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'changeme123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    // Flush login() microtask
    await vi.advanceTimersByTimeAsync(0);

    // Min timer not elapsed, prefetch still pending — should not navigate
    expect(mockNavigate).not.toHaveBeenCalled();

    // Advance to exactly the 1s minimum timer
    await vi.advanceTimersByTimeAsync(1000);

    // Prefetch still pending — navigation should be blocked
    expect(mockNavigate).not.toHaveBeenCalled();

    // Resolve prefetch — navigation should fire now
    resolvePrefetch();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('navigates after max timeout even when prefetch is slow', async () => {
    vi.useFakeTimers();

    // Prefetch that never resolves (simulates very slow network)
    mockPrefetchQuery.mockReturnValue(new Promise<void>(() => {}));
    mockLogin.mockResolvedValue({ defaultLandingPage: '/' });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'changeme123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    await vi.advanceTimersByTimeAsync(0);

    // Should not navigate before max timeout
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockNavigate).not.toHaveBeenCalled();

    // Advance past 5s max cap — navigation should fire
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
