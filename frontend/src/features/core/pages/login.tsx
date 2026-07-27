import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/features/core/hooks/use-auth";
import { useOIDCStatus } from "@/features/core/hooks/use-oidc";
import { LoginLogo } from "@/shared/components/icons/login-logo";
import { useUiStore } from "@/stores/ui-store";
import { PostLoginLoading } from "@/shared/components/layout/post-login-loading";
import { AnimatePresence } from "framer-motion";
import { api } from "@/shared/lib/api";
import { PRODUCT_NAME } from "@/shared/lib/product";

/**
 * How long the prefetch may run before the loading screen appears.
 *
 * The screen used to be shown immediately and held for a **one-second minimum**
 * even when the prefetch had already resolved, so a correct password during an
 * incident cost the operator a second of animation. It is now a slow-path
 * affordance only: under this threshold the sign-in feels instant and the
 * screen never mounts.
 */
const LOADING_SCREEN_DELAY_MS = 300;

/** Hard cap on the post-login prefetch so a slow network cannot trap the user. */
const PREFETCH_MAX_WAIT_MS = 3000;

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: oidcStatus } = useOIDCStatus();
  const potatoMode = useUiStore((state) => state.potatoMode);
  const prefersReducedMotion = usePrefersReducedMotion();
  const reducedMotion = prefersReducedMotion || potatoMode;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success">("idle");
  const [showPostLoginLoading, setShowPostLoginLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const slowPathTimerRef = useRef<number | null>(null);

  const stagedClass = useMemo(
    () => (reducedMotion ? "" : "login-stage-in"),
    [reducedMotion],
  );

  useEffect(() => {
    return () => {
      if (slowPathTimerRef.current !== null) {
        window.clearTimeout(slowPathTimerRef.current);
      }
    };
  }, []);

  if (isAuthenticated && !isLoggingIn) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitState("loading");
    setIsLoggingIn(true);

    try {
      const { defaultLandingPage } = await login(username, password);
      setSubmitState("success");

      // Always prefetch dashboard data after login, regardless of motion preference
      const prefetchPromise = queryClient.prefetchQuery({
        queryKey: ['dashboard', 'full', 8],
        queryFn: () => api.get('/api/dashboard/full?topN=8&kpiHistoryHours=24'),
        staleTime: 2 * 60 * 1000,
      });

      // Slow path only: if the prefetch is still in flight after 300ms, cover
      // the wait. A fast prefetch navigates before this ever fires, so there is
      // no floor on how quickly a correct password gets you to the dashboard.
      if (!reducedMotion) {
        slowPathTimerRef.current = window.setTimeout(
          () => setShowPostLoginLoading(true),
          LOADING_SCREEN_DELAY_MS,
        );
      }

      const maxTimer = new Promise<void>((resolve) =>
        window.setTimeout(resolve, PREFETCH_MAX_WAIT_MS),
      );

      Promise.race([prefetchPromise, maxTimer]).then(() => {
        if (slowPathTimerRef.current !== null) {
          window.clearTimeout(slowPathTimerRef.current);
          slowPathTimerRef.current = null;
        }
        navigate(defaultLandingPage || "/", { replace: true });
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid username or password"
      );
      setSubmitState("idle");
      setIsLoggingIn(false);
    }
  }

  function getStagedStyle(delayMs: number): CSSProperties | undefined {
    if (reducedMotion) {
      return undefined;
    }
    return { animationDelay: `${delayMs}ms` };
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4"
      data-reduced-motion={reducedMotion}
    >
      {createPortal(
        <AnimatePresence>
          {showPostLoginLoading && <PostLoginLoading />}
        </AnimatePresence>,
        document.body
      )}

      <div
        className={`login-gradient-mesh ${reducedMotion ? "" : "login-gradient-mesh-animate"}`}
        aria-hidden="true"
        data-testid="login-gradient"
      />

      {/*
        The card is deliberately opaque. At `bg-card/85` the page background bled
        through, dropping the muted-foreground token to 4.31:1 — below AA — while
        the same token measures 4.62:1 on an opaque card.
      */}
      <div className={`login-card z-10 w-full max-w-sm rounded-2xl border bg-card p-8 shadow-2xl ${stagedClass}`}>
        <div className="mb-6 text-center">
          <div className={`mx-auto mb-3 grid place-items-center ${reducedMotion ? "" : "login-logo-shell"}`}>
            <LoginLogo reducedMotion={reducedMotion} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{PRODUCT_NAME}</h1>
          <p
            className={`mt-3 text-sm text-muted-foreground ${stagedClass}`}
            style={getStagedStyle(120)}
          >
            Sign in to your account
          </p>
        </div>

        {oidcStatus?.enabled && oidcStatus.authUrl && (
          <>
            <button
              type="button"
              onClick={() => {
                if (oidcStatus.authUrl) {
                  window.location.href = oidcStatus.authUrl;
                }
              }}
              className={`inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background/85 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${stagedClass}`}
              style={getStagedStyle(160)}
            >
              Login with SSO
            </button>

            <div className={`relative my-4 ${stagedClass}`} style={getStagedStyle(210)}>
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with credentials</span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" data-testid="login-error" className="login-error-shake rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className={`space-y-2 ${stagedClass}`} style={getStagedStyle(260)}>
            <label
              htmlFor="username"
              className="text-sm font-medium leading-none"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
              autoComplete="username"
              className="login-input flex h-10 w-full rounded-md border border-input bg-background/85 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
          </div>

          <div className={`space-y-2 ${stagedClass}`} style={getStagedStyle(310)}>
            <label
              htmlFor="password"
              className="text-sm font-medium leading-none"
            >
              Password
            </label>
            {/*
              The password here is usually a long generated string pasted from a
              vault, so a reveal toggle is the difference between one attempt and
              a retry loop.
            */}
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                className="login-input flex h-10 w-full rounded-md border border-input bg-background/85 py-2 pl-3 pr-11 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitState !== "idle"}
            className={`login-submit relative inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-80 ${stagedClass}`}
            style={getStagedStyle(360)}
          >
            <span className={`transition-opacity duration-150 ${submitState === "idle" ? "opacity-100" : "opacity-0"}`}>
              Sign in
            </span>
            {submitState === "loading" && (
              <span className="absolute inset-0 inline-flex items-center justify-center gap-2">
                <span className="login-spinner" aria-hidden="true" />
                <span>Signing in...</span>
              </span>
            )}
            {submitState === "success" && (
              <span className="absolute inset-0 inline-flex items-center justify-center">
                Signed in
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
