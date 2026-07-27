import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '@/shared/lib/api';
import { useAuth } from '@/features/core/hooks/use-auth';

/** How long the failure is left on screen before the automatic bounce to /login. */
const REDIRECT_DELAY_MS = 3000;

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Owned by this effect run, so a re-run or an unmount cancels it. Without
    // the cleanup a torn-down page could still navigate three seconds later.
    let redirectTimer: number | null = null;
    const scheduleRedirect = () => {
      redirectTimer = window.setTimeout(
        () => navigate('/login', { replace: true }),
        REDIRECT_DELAY_MS,
      );
    };

    if (errorParam) {
      setError(errorDescription || errorParam);
      scheduleRedirect();
      return () => {
        if (redirectTimer !== null) window.clearTimeout(redirectTimer);
      };
    }

    if (!code || !state) {
      setError('Missing authorization code or state');
      scheduleRedirect();
      return () => {
        if (redirectTimer !== null) window.clearTimeout(redirectTimer);
      };
    }

    async function exchangeCode() {
      try {
        const data = await api.post<{ token: string; username: string; expiresAt: string }>(
          '/api/auth/oidc/callback',
          { callbackUrl: window.location.href, state }
        );

        loginWithToken(data.token, data.username);
        navigate('/', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        scheduleRedirect();
      }
    }

    exchangeCode();

    return () => {
      if (redirectTimer !== null) window.clearTimeout(redirectTimer);
    };
  }, [searchParams, navigate, loginWithToken]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-lg text-center">
          {/* Matches the sign-in form: a failure has to reach a screen reader. */}
          <div
            role="alert"
            data-testid="auth-callback-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4"
          >
            {error}
          </div>
          <p className="text-sm text-muted-foreground">
            Redirecting to login...
          </p>
          {/* The 3s bounce stays, but nobody has to sit through it. */}
          <Link
            to="/login"
            replace
            className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to sign-in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-lg text-center">
        <div
          className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground" role="status">
          Completing sign-in...
        </p>
      </div>
    </div>
  );
}
