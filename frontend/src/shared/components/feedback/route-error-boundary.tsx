import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Home, WifiOff, FileQuestion } from 'lucide-react';
import { useState } from 'react';

interface ErrorDetails {
  title: string;
  message: string;
  icon: React.ReactNode;
  showReload: boolean;
  showHome: boolean;
}

function getErrorDetails(error: unknown): ErrorDetails {
  // Check for module load failures (chunk loading errors)
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('failed to fetch dynamically imported module') ||
      message.includes('importing a module script failed') ||
      message.includes('loading chunk') ||
      message.includes('loading css chunk')
    ) {
      return {
        title: 'Failed to load page',
        message: 'A network error occurred while loading this page. This can happen due to a poor connection or after an application update.',
        icon: <WifiOff className="h-6 w-6 text-destructive" />,
        showReload: true,
        showHome: true,
      };
    }
  }

  // Handle React Router error responses (404, etc.)
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        title: 'Page not found',
        message: "The page you're looking for doesn't exist or has been moved.",
        icon: <FileQuestion className="h-6 w-6 text-muted-foreground" />,
        showReload: false,
        showHome: true,
      };
    }
    return {
      title: `Error ${error.status}`,
      message: error.statusText || 'An unexpected error occurred.',
      icon: <AlertTriangle className="h-6 w-6 text-destructive" />,
      showReload: true,
      showHome: true,
    };
  }

  // Generic error fallback
  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    icon: <AlertTriangle className="h-6 w-6 text-destructive" />,
    showReload: true,
    showHome: true,
  };
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

  const details = getErrorDetails(error);

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            {details.icon}
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {details.title}
          </h1>
          <p className="text-muted-foreground">
            {details.message}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          {details.showReload && (
            <button
              onClick={handleReload}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Page
            </button>
          )}
          {details.showHome && (
            <button
              onClick={handleGoHome}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Home className="h-4 w-4" />
              Go to Dashboard
            </button>
          )}
        </div>

        {error instanceof Error && (
          <div className="pt-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {showDetails ? 'Hide' : 'Show'} technical details
            </button>
            {showDetails && (
              <div className="mt-3 rounded-md border bg-muted/50 p-3 text-left">
                <p className="font-mono text-xs text-muted-foreground break-all">
                  {error.message}
                </p>
                {error.stack && (
                  <pre className="mt-2 max-h-32 overflow-auto font-mono text-xs text-muted-foreground/70">
                    {error.stack}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
