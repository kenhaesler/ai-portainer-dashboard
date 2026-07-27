import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import LoginPage from './login';
import { PRODUCT_NAME } from '@/shared/lib/product';
import {
  LOGIN_BAD_CREDENTIALS_MESSAGE,
  LOGIN_RATE_LIMITED_MESSAGE,
} from '@/providers/auth-provider';

const mockNavigate = vi.fn();
const mockLogin = vi.fn();
const mockUseAuth = vi.fn();
const mockUseOIDCStatus = vi.fn();
const mockPrefetchQuery = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
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

vi.mock('@/shared/lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/features/core/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/core/hooks/use-oidc', () => ({
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

  it('renders the sign-in form under the product wordmark', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('login-gradient')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PRODUCT_NAME);
    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('img', { name: 'Brain logo' })).toBeInTheDocument();
  });

  it('uses the shared product name, not one of its three rivals', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Container Insights');
    expect(screen.queryByText(/Docker Insights?/)).not.toBeInTheDocument();
  });

  it('drops the "powered by AI" typewriter tagline', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/powered by ai/i)).not.toBeInTheDocument();
    expect(document.querySelector('.login-typewriter')).toBeNull();
  });

  it('drops the floating particles, keeping the gradient mesh and the staggered entrance', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(document.querySelectorAll('.login-particle')).toHaveLength(0);
    expect(screen.getByTestId('login-gradient').className).toContain('login-gradient-mesh-animate');
    expect(document.querySelectorAll('.login-stage-in').length).toBeGreaterThan(0);
  });

  it('renders the username and password fields empty on initial render', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Username')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('respects reduced motion by disabling the entrance animation', () => {
    stubMatchMedia(true);

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(document.querySelectorAll('.login-stage-in')).toHaveLength(0);
    expect(screen.getByTestId('login-gradient').className).not.toContain('login-gradient-mesh-animate');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps muted card text on an opaque card so it clears AA contrast', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const card = document.querySelector('.login-card');
    expect(card).not.toBeNull();
    // `bg-card/85` let the page background through, which is the pairing that
    // measures 4.31:1 for `text-muted-foreground` (AA needs 4.5:1).
    expect(card!.className).toContain('bg-card');
    expect(card!.className).not.toContain('bg-card/');
  });

  it('toggles password visibility so a pasted vault secret can be checked', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const passwordField = screen.getByLabelText('Password');
    expect(passwordField).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');

    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(hide);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('announces login failure to screen readers via role="alert" (#1541)', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid username or password'));

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid username or password');
    expect(alert).toBe(screen.getByTestId('login-error'));
  });

  /**
   * The wrong-password path was fixed at the API layer (`suppressSessionExpiry`
   * on `/api/auth/login` plus `describeLoginFailure` in `AuthProvider`). This
   * asserts the page renders that message verbatim and never the session-expiry
   * string, which is what a bad password used to report.
   */
  it('renders "Incorrect username or password" for a wrong password, never "Session expired"', async () => {
    mockLogin.mockRejectedValue(new Error(LOGIN_BAD_CREDENTIALS_MESSAGE));

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Incorrect username or password');
    expect(alert).not.toHaveTextContent(/session expired/i);
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });

  it('renders the rate-limit message when the server throttles sign-in', async () => {
    mockLogin.mockRejectedValue(new Error(LOGIN_RATE_LIMITED_MESSAGE));

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many sign-in attempts. Wait a minute before trying again.');
  });

  it('re-enables the form after a failed attempt', async () => {
    mockLogin.mockRejectedValue(new Error(LOGIN_BAD_CREDENTIALS_MESSAGE));

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
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
        staleTime: 2 * 60_000,
      }),
    );
  });

  /**
   * The regression this guards: a `Promise.all([minTimer, …])` held the loading
   * screen for a full second after a correct password, so an operator signing in
   * during an incident waited on an animation. Navigation is now bounded only by
   * the prefetch.
   */
  it('navigates as soon as the prefetch resolves, with no minimum delay', async () => {
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
    expect(mockNavigate).not.toHaveBeenCalled();

    // 50ms in — well under any old minimum — the prefetch lands and we go.
    await vi.advanceTimersByTimeAsync(50);
    resolvePrefetch();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('never mounts the loading screen when the prefetch resolves quickly', async () => {
    vi.useFakeTimers();

    let resolvePrefetch!: () => void;
    mockPrefetchQuery.mockReturnValue(new Promise<void>((r) => { resolvePrefetch = r; }));
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
    await vi.advanceTimersByTimeAsync(100);
    resolvePrefetch();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });

    // The slow-path timer must have been cancelled, not merely outraced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByRole('img', { name: 'Loading logo' })).toBeNull();
  });

  it('shows the loading screen only once the prefetch runs past the slow-path threshold', async () => {
    vi.useFakeTimers();

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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(screen.queryByRole('img', { name: 'Loading logo' })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('img', { name: 'Loading logo' })).toBeInTheDocument();
  });

  it('navigates after the cap even when the prefetch never resolves', async () => {
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

    await vi.advanceTimersByTimeAsync(2999);
    expect(mockNavigate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('does not fire a confetti burst on a successful sign-in', async () => {
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

    expect(document.querySelectorAll('.login-burst')).toHaveLength(0);
  });
});
