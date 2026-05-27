import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>;

export interface CheckboxProps extends NativeProps {
  indeterminate?: boolean;
  size?: 'sm' | 'md';
}

/**
 * Themed checkbox. Renders a native `<input type="checkbox">` so click,
 * keyboard, disabled, and form semantics match the platform — the icon
 * sibling is purely cosmetic and pointer-events-none.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, indeterminate, disabled, checked, size = 'md', ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  const box = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const icon = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';

  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', box)}>
      <input
        ref={innerRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className={cn(
          'peer m-0 cursor-pointer appearance-none rounded-[4px] border border-input bg-background',
          'transition-colors duration-150',
          'hover:border-primary/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'checked:border-primary checked:bg-primary',
          'indeterminate:border-primary indeterminate:bg-primary',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-input',
          box,
          className,
        )}
        {...rest}
      />
      {indeterminate ? (
        <Minus
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute text-primary-foreground opacity-0 peer-indeterminate:opacity-100',
            icon,
          )}
          strokeWidth={3}
        />
      ) : (
        <Check
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute text-primary-foreground opacity-0 peer-checked:opacity-100',
            icon,
          )}
          strokeWidth={3}
        />
      )}
    </span>
  );
});
