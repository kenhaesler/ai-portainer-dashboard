import { Toaster } from 'sonner';
import { useThemeStore } from '@/stores/theme-store';

export function ToastContainer() {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const theme = resolvedTheme();

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        className: 'border border-border',
      }}
    />
  );
}
