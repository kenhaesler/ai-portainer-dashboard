import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCallbackPage from './auth-callback';

const mockNavigate = vi.fn();
const mockLoginWithToken = vi.fn();
const mockApiPost = vi.fn();
let currentSearch = '';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(currentSearch), vi.fn()],
  };
});

vi.mock('@/features/core/hooks/use-auth', () => ({
  useAuth: () => ({
    loginWithToken: mockLoginWithToken,
  }),
}));

vi.mock('@/shared/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

function renderPage(search: string) {
  currentSearch = search;
  return render(
    <MemoryRouter>
      <AuthCallbackPage />
    </MemoryRouter>,
  );
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    mockLoginWithToken.mockReset();
    mockApiPost.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful OIDC callback', () => {
    it('exchanges the code, calls loginWithToken and redirects to "/"', async () => {
      mockApiPost.mockResolvedValue({
        token: 'jwt.token.value',
        username: 'alice',
        expiresAt: '2099-01-01T00:00:00Z',
      });

      renderPage('?code=auth-code-123&state=state-xyz');

      // Loading spinner shown initially
      expect(screen.getByText(/Completing sign-in/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/auth/oidc/callback',
          expect.objectContaining({ state: 'state-xyz' }),
        );
      });

      await waitFor(() => {
        expect(mockLoginWithToken).toHaveBeenCalledWith('jwt.token.value', 'alice');
      });
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });

    it('passes the current callback URL to the backend', async () => {
      mockApiPost.mockResolvedValue({
        token: 'tok',
        username: 'bob',
        expiresAt: '2099-01-01T00:00:00Z',
      });

      renderPage('?code=c&state=s');

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/auth/oidc/callback',
          expect.objectContaining({
            callbackUrl: window.location.href,
            state: 's',
          }),
        );
      });
    });
  });

  describe('missing token / state path', () => {
    it('renders an error and redirects to /login when code is missing', async () => {
      vi.useFakeTimers();
      renderPage('?state=only-state');

      // Error message rendered immediately on the synchronous effect path
      expect(
        screen.getByText(/Missing authorization code or state/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Redirecting to login/i)).toBeInTheDocument();

      // Backend never called
      expect(mockApiPost).not.toHaveBeenCalled();

      // Redirect happens after the 3s delay
      vi.advanceTimersByTime(3000);
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('renders an error and redirects to /login when state is missing', async () => {
      vi.useFakeTimers();
      renderPage('?code=only-code');

      expect(
        screen.getByText(/Missing authorization code or state/i),
      ).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  describe('OIDC error in URL params', () => {
    it('shows error_description and redirects to /login', async () => {
      vi.useFakeTimers();
      renderPage('?error=access_denied&error_description=User%20cancelled');

      expect(screen.getByText('User cancelled')).toBeInTheDocument();

      // Backend not called for upstream OIDC error
      expect(mockApiPost).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('falls back to error code when error_description is absent', async () => {
      renderPage('?error=access_denied');

      expect(screen.getByText('access_denied')).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe('backend exchange failure', () => {
    it('renders the failure message and redirects to /login', async () => {
      mockApiPost.mockRejectedValue(new Error('OIDC exchange failed'));

      renderPage('?code=c&state=s');

      // Wait for the rejected promise to settle and component to re-render
      await waitFor(() => {
        expect(screen.getByText('OIDC exchange failed')).toBeInTheDocument();
      });

      expect(mockLoginWithToken).not.toHaveBeenCalled();
    });

    it('shows a generic message when the rejection is not an Error instance', async () => {
      mockApiPost.mockRejectedValue('not-an-error');

      renderPage('?code=c&state=s');

      await waitFor(() => {
        expect(screen.getByText('Authentication failed')).toBeInTheDocument();
      });
    });
  });
});
