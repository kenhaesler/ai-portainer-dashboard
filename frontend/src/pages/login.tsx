import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useOIDCStatus } from "@/hooks/use-oidc";
import { LoginLogo } from "@/components/icons/login-logo";
import { useUiStore } from "@/stores/ui-store";
import { PostLoginLoading } from "@/components/shared/post-login-loading";
import { AnimatePresence } from "framer-motion";

const PARTICLES = [
  { left: "8%", delay: "0s", duration: "12s", size: "7px" },
  { left: "18%", delay: "0.8s", duration: "15s", size: "9px" },
  { left: "28%", delay: "0.4s", duration: "13s", size: "6px" },
  { left: "39%", delay: "1.2s", duration: "14s", size: "8px" },
  { left: "48%", delay: "0.2s", duration: "16s", size: "7px" },
  { left: "57%", delay: "1.5s", duration: "12s", size: "8px" },
  { left: "66%", delay: "0.6s", duration: "17s", size: "9px" },
  { left: "75%", delay: "1.1s", duration: "11s", size: "6px" },
  { left: "84%", delay: "0.9s", duration: "15s", size: "8px" },
  { left: "92%", delay: "0.3s", duration: "13s", size: "7px" },
];

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
  const { data: oidcStatus } = useOIDCStatus();
  const potatoMode = useUiStore((state) => state.potatoMode);
  const prefersReducedMotion = usePrefersReducedMotion();
  const reducedMotion = prefersReducedMotion || potatoMode;
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("changeme123");
  const [error, setError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success">("idle");
  const [showPostLoginLoading, setShowPostLoginLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const stagedClass = useMemo(
    () => (reducedMotion ? "" : "login-stage-in"),
    [reducedMotion],
  );

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
      
      if (reducedMotion) {
        window.setTimeout(() => {
          navigate(defaultLandingPage || "/", { replace: true });
        }, 0);
      } else {
        // Show the high-quality loading screen immediately
        setShowPostLoginLoading(true);
        window.setTimeout(() => {
          navigate(defaultLandingPage || "/", { replace: true });
        }, 3500); // Increased to 3.5 seconds for better impact
      }
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
      <AnimatePresence>
        {showPostLoginLoading && <PostLoginLoading />}
      </AnimatePresence>

      <div
        className={`login-gradient-mesh ${reducedMotion ? "" : "login-gradient-mesh-animate"}`}
        aria-hidden="true"
        data-testid="login-gradient"
      />

      {!reducedMotion && (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          {PARTICLES.map((particle) => (
            <span
              key={`${particle.left}-${particle.delay}`}
              className="login-particle"
              style={
                {
                  left: particle.left,
                  width: particle.size,
                  height: particle.size,
                  animationDelay: particle.delay,
                  animationDuration: particle.duration,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      <div className={`login-card z-10 w-full max-w-sm rounded-2xl border bg-card/85 p-8 shadow-2xl ${stagedClass}`}>
        <div className="mb-6 text-center">
          <div className={`mx-auto mb-3 grid place-items-center ${reducedMotion ? "" : "login-logo-shell"}`}>
            <LoginLogo reducedMotion={reducedMotion} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Docker Insights</h1>
          <p className={`mt-1 text-xs uppercase tracking-[0.24em] text-muted-foreground ${reducedMotion ? "" : "login-typewriter"}`}>
            powered by AI
          </p>
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
            <div data-testid="login-error" className="login-error-shake rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              className="login-input flex h-10 w-full rounded-md border border-input bg-background/85 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
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
            {submitState === "success" && !reducedMotion && (
              <span className="pointer-events-none absolute inset-0" aria-hidden="true">
                <span className="login-burst login-burst-1" />
                <span className="login-burst login-burst-2" />
                <span className="login-burst login-burst-3" />
                <span className="login-burst login-burst-4" />
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
