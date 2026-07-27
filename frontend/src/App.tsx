import { RouterProvider } from 'react-router';
import { router } from './router';
import { ThemeProvider } from './providers/theme-provider';
import { QueryProvider } from './providers/query-provider';
import { AuthProvider } from './providers/auth-provider';
import { SocketProvider } from './providers/socket-provider';
import { SearchProvider } from './providers/search-provider';
import { Toaster } from 'sonner';
import { LazyMotion, MotionConfig } from 'framer-motion';
import { useUiStore } from './stores/ui-store';
import { useEffect } from 'react';

// Async LazyMotion feature loading (#1507): all animated components use the
// lightweight `m` component, and the feature bundle (domMax — required for the
// sidebar's layout/layoutId animations) loads in a separate chunk off the
// startup critical path. Animations activate as soon as the chunk arrives.
const loadMotionFeatures = () => import('./lib/motion-features').then((mod) => mod.default);

export function App() {
  const potatoMode = useUiStore((state) => state.potatoMode);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-potato-mode', potatoMode);
    return () => {
      document.documentElement.removeAttribute('data-potato-mode');
    };
  }, [potatoMode]);

  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <SocketProvider>
            <SearchProvider>
              {/* Keep motion payload off the critical path by lazy-loading features */}
              <LazyMotion features={loadMotionFeatures}>
                <MotionConfig reducedMotion={potatoMode ? 'always' : 'user'}>
                  <RouterProvider router={router} />
                </MotionConfig>
              </LazyMotion>
              <Toaster richColors position="top-right" />
            </SearchProvider>
          </SocketProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
