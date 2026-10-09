import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api } from '@/shared/lib/api';
import { useAuth } from '@/features/core/hooks/use-auth';

/** How long the failure is left on screen before the automatic bounce to /login. */
const REDIRECT_DELAY_MS = 3000;

/** The exchange response must carry a usable session before we log in. */
const callbackResponseSchema = z.object({
  token: z.string().min(1),
  username: z.string().min(1),
});

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Primitives, not the searchParams object: its identity changes on re-render
  // and would otherwise re-run the (single-use) code exchange.
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // The authorization code is single-use. A ref survives StrictMode's
  // mount/cleanup/mount replay, so the second run reuses the first run's
  // in-flight request instead of sending the code again.
  const exchangeRef = useRef<{ key: string; promise: Promise<unknown> } | null>(null);

  useEffect(() => {
    // Set by cleanup: a superseded or unmounted run never sets state or navigates.
    let cancelled = false;
    let redirectTimer: number | null = null;
    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      redirectTimer = window.setTimeout(
        () => navigate('/login', { replace: true }),
        REDIRECT_DELAY_MS,
      );
    };
    const cleanup = () => {
      cancelled = true;
      if (redirectTimer !== null) window.clearTimeout(redirectTimer);
    };

    if (errorParam) {
      fail(errorDescription || errorParam);
      return cleanup;
    }

    if (!code || !state) {
      fail('Missing authorization code or state');
      return cleanup;
    }

    const key = `${code}:${state}`;
    if (exchangeRef.current?.key !== key) {
      exchangeRef.current = {
        key,
        promise: api.post<unknown>('/api/auth/oidc/callback', {
          callbackUrl: window.location.href,
          state,
        }),
      };
    }
    const attempt = exchangeRef.current;

    attempt.promise.then(
      (payload) => {
        if (cancelled) return;
        const parsed = callbackResponseSchema.safeParse(payload);
        if (!parsed.success) {
          if (exchangeRef.current === attempt) exchangeRef.current = null;
          fail('The sign-in response was incomplete. Return to sign-in and try again.');
          return;
        }
        loginWithToken(parsed.data.token, parsed.data.username);
        navigate('/', { replace: true });
      },
      (err: unknown) => {
        // Forget a failed attempt so a genuine retry can exchange again.
        if (exchangeRef.current === attempt) exchangeRef.current = null;
        fail(err instanceof Error ? err.message : 'Authentication failed');
      },
    );

    return cleanup;
  }, [code, state, errorParam, errorDescription, navigate, loginWithToken]);

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
