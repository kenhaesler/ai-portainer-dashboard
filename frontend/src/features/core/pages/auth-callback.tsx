import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/shared/lib/api';
import { useAuth } from '@/features/core/hooks/use-auth';

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

    if (errorParam) {
      setError(errorDescription || errorParam);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
      return;
    }

    if (!code || !state) {
      setError('Missing authorization code or state');
      setTimeout(() => navigate('/login', { replace: true }), 3000);
      return;
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
        setTimeout(() => navigate('/login', { replace: true }), 3000);
      }
    }

    exchangeCode();
  }, [searchParams, navigate, loginWithToken]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-lg text-center">
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
            {error}
          </div>
          <p className="text-sm text-muted-foreground">
            Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-lg text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">
          Completing sign-in...
        </p>
      </div>
    </div>
  );
}
