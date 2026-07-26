import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface PageHeaderProps {
  /** The page title. Rendered as the page's single `<h1>`. */
  title: string;
  /**
   * One line under the title. Omit it rather than filling the slot: if deleting
   * the subtitle costs the operator nothing, it was decoration.
   * Inline content only — it renders inside a `<div>`, so a badge or a `<span>`
   * with live state is fine, a card is not.
   */
  subtitle?: ReactNode;
  /** Right-aligned controls on the title row (refresh controls, buttons, filters). */
  actions?: ReactNode;
  /**
   * Hide the subtitle below `sm`. Default `true` — on a phone the header block
   * costs a large share of the fold, and the title alone identifies the page.
   * Set `false` only when the subtitle carries state the title does not.
   */
  hideSubtitleOnMobile?: boolean;
  /** Extra classes on the wrapper (spacing only — do not restyle the title). */
  className?: string;
}

/**
 * The one page-header shape.
 *
 * Every page used to hand-roll this block, 11 files wrote the same title string
 * twice (loading branch + loaded branch), and with nothing enforcing the shape
 * one page's `<h1>` drifted into a gradient with an icon tile while its 19
 * siblings stayed plain. There are deliberately no per-page escape hatches: no
 * gradient, no icon slot, no title size override. `text-3xl font-bold
 * tracking-tight` is the established desktop scale (17 of 20 pages); it steps
 * down to `text-xl` below `sm`.
 *
 * Render it in the loading branch too — passing the same `title` while the data
 * is in flight is what stops the string being written twice.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  hideSubtitleOnMobile = true,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-testid="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-3', className)}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle != null && subtitle !== false && (
          <div
            data-testid="page-header-subtitle"
            className={cn(
              'mt-1 text-sm text-muted-foreground',
              hideSubtitleOnMobile && 'hidden sm:block'
            )}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions != null && actions !== false && (
        <div
          data-testid="page-header-actions"
          className="flex shrink-0 flex-wrap items-center gap-2"
        >
          {actions}
        </div>
      )}
    </div>
  );
}
