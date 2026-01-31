import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ThemeProvider } from './providers/theme-provider';
import { QueryProvider } from './providers/query-provider';
import { AuthProvider } from './providers/auth-provider';
import { SocketProvider } from './providers/socket-provider';
import { Toaster } from 'sonner';

export function App() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <SocketProvider>
            <RouterProvider router={router} />
            <Toaster richColors position="top-right" />
          </SocketProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
