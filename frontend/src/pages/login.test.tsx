import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './login';

const mockNavigate = vi.fn();
const mockLogin = vi.fn();
const mockUseAuth = vi.fn();
const mockUseOIDCStatus = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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
    expect(screen.getByText(/powered by ai/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('admin');
    expect(screen.getByLabelText('Password')).toHaveValue('changeme123');
    expect(document.querySelectorAll('.login-particle')).toHaveLength(10);
    expect(screen.getByRole('img', { name: 'AI brain logo' })).toBeInTheDocument();
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
});
