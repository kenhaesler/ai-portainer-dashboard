import * as Dialog from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  /** Disables both buttons and swaps the confirm label for a spinner. */
  isLoading?: boolean;
  /** Extra content (e.g. a form field) rendered between the description and the buttons. */
  children?: React.ReactNode;
  /** Test id applied to the dialog content element. */
  'data-testid'?: string;
}

/**
 * Shared confirmation dialog built on Radix UI Dialog.
 *
 * Replaces native `window.confirm()` calls with an accessible, themed modal
 * that matches the project's glassmorphic design system. Radix provides the
 * dialog role, aria-modal, focus trap, Escape-to-close, and focus restore.
 */
export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  children,
  'data-testid': dataTestId,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isLoading) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          aria-describedby="confirm-dialog-description"
          data-testid={dataTestId}
        >
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description id="confirm-dialog-description" className="mt-2 text-sm text-muted-foreground">
            {description}
          </Dialog.Description>
          {children}
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50',
                variant === 'danger'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : variant === 'warning'
                    ? 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="Working" />
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
