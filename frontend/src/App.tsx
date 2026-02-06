import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ThemeProvider } from './providers/theme-provider';
import { QueryProvider } from './providers/query-provider';
import { AuthProvider } from './providers/auth-provider';
import { SocketProvider } from './providers/socket-provider';
import { SearchProvider } from './providers/search-provider';
import { Toaster } from 'sonner';
import { domAnimation, LazyMotion, MotionConfig } from 'framer-motion';

export function App() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <SocketProvider>
            <SearchProvider>
              {/* Keep motion payload small by loading domAnimation features once */}
              <LazyMotion features={domAnimation}>
                <MotionConfig reducedMotion="user">
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
