import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

type SelectEntry = SelectOption | SelectOptionGroup;

interface ThemedSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectEntry[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function ThemedSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  disabled,
  className,
  id,
}: ThemedSelectProps) {
  const isGroup = (entry: SelectEntry): entry is SelectOptionGroup => 'options' in entry;

  const renderOption = (opt: SelectOption, inset = false) => (
    <SelectPrimitive.Item
      key={opt.value}
      value={opt.value}
      disabled={opt.disabled}
      className={cn(
        'themed-select-item relative flex w-full cursor-pointer select-none items-center rounded-xl py-1.5 pl-8 pr-2 text-sm outline-none',
        'hover:rounded-xl focus:rounded-xl data-[highlighted]:rounded-xl',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        inset && 'pl-10',
      )}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );

  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        className={cn(
          'inline-flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs',
          'ring-offset-background transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-placeholder:text-muted-foreground',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((entry, index) => {
              if (!isGroup(entry)) {
                return renderOption(entry);
              }

              return (
                <SelectPrimitive.Group key={`${entry.label}-${index}`}>
                  {index > 0 && <SelectPrimitive.Separator className="my-2 h-px bg-border" />}
                  <SelectPrimitive.Label className="mx-1 mb-1 rounded-md border border-border/70 bg-muted/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90 shadow-xs">
                    {entry.label}
                  </SelectPrimitive.Label>
                  {entry.options.map((opt) => renderOption(opt, true))}
                </SelectPrimitive.Group>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
