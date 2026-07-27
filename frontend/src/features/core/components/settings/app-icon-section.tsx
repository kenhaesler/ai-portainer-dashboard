import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useThemeStore } from '@/stores/theme-store';
import { ICON_SETS, ICON_SET_MAP, type AppIconId, type IconSetDefinition } from '@/shared/components/icons/icon-sets';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { cn } from '@/shared/lib/utils';

/**
 * One app-icon picker, three honest previews, per-surface overrides on demand.
 *
 * This replaces three near-identical 10-option grids — "Favicon Icon",
 * "Sidebar Logo", "Login Logo" — that shipped byte-identical option sets and
 * byte-identical per-option descriptions: thirty radio cards to choose a logo
 * three times, in a console where the same admin cannot set an SMTP host. A
 * design review named it the clearest remaining filler in the product.
 *
 * What is deliberately kept: the three *previews*. They were never
 * duplication — each shows how the mark actually renders in its own context,
 * and they are three genuinely different paint paths. Collapsing to a single
 * preview would have thrown away two of the three answers to "what will this
 * look like there".
 *
 * Model: `faviconIcon` is the primary; a surface is overridden when its value
 * differs from it. Nothing new is persisted, so no `version` bump and no
 * `migrate` — see the note on `setAppIcon` in `theme-store.ts`.
 */

/** Gradient used by the sign-in mark. Hoisted so exactly one definition exists. */
const LOGIN_STROKE_GRADIENT_ID = 'appicon-login-stroke';
/** Plate behind the favicon mark, drawn inside the glyph's own 64-unit box. */
const FAVICON_PLATE_GRADIENT_ID = 'appicon-favicon-plate';

/**
 * How a glyph's `currentColor` is painted.
 *
 * `inherit` leaves it to CSS (the sidebar chip tints via `text-*`), `solid`
 * substitutes a literal, `gradient` substitutes a `url(#…)` reference. The
 * substitution applies to whichever of `fill`/`stroke` the path actually
 * carries — the default Brain mark is stroke-only, several others are both.
 */
type GlyphPaint =
  | { kind: 'inherit' }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; id: string };

function paintValue(declared: string | undefined, paint: GlyphPaint): string {
  if (declared !== 'currentColor') return declared ?? 'none';
  if (paint.kind === 'solid') return paint.color;
  if (paint.kind === 'gradient') return `url(#${paint.id})`;
  return 'currentColor';
}

/**
 * One app-icon mark.
 *
 * Supplying `label` makes it an image with an accessible name; omitting it
 * makes it decorative. Encoding the choice in the prop shape means
 * "labelled but hidden" and "unlabelled but role=img" are unrepresentable.
 */
export function AppIconGlyph({
  icon,
  paint = { kind: 'inherit' },
  className,
  label,
  backdrop,
}: {
  icon: IconSetDefinition;
  paint?: GlyphPaint;
  className?: string;
  label?: string;
  /** Drawn before the paths, inside the same viewBox — used for the favicon plate. */
  backdrop?: ReactNode;
}) {
  const a11y = label
    ? ({ role: 'img' as const, 'aria-label': label })
    : ({ 'aria-hidden': true as const, focusable: 'false' as const });

  return (
    <svg viewBox={icon.viewBox} className={className} {...a11y}>
      {backdrop}
      {icon.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={paintValue(p.fill, paint)}
          stroke={paintValue(p.stroke, paint)}
          strokeWidth={p.strokeWidth}
          strokeLinecap={p.strokeLinecap}
          strokeLinejoin={p.strokeLinejoin}
        />
      ))}
    </svg>
  );
}

/**
 * The three surfaces, in the order an operator meets them.
 *
 * `chip` renders the mark the way that surface really renders it. The sidebar
 * treatment is corrected here: the old preview used `bg-muted`/`text-foreground`
 * at h-5, while the real brand chip is `bg-sidebar-primary` /
 * `text-sidebar-primary-foreground` at h-4 — on Glass Light that is a dark
 * glyph on grey versus a light glyph on near-black, i.e. the preview was
 * showing the wrong thing.
 */
const SURFACES = [
  {
    key: 'favicon' as const,
    caption: 'Browser tab',
    chip: (icon: IconSetDefinition) => (
      // Full-bleed: the real favicon draws its paths across the same 64-unit
      // box as its rounded plate, so an inset glyph in a CSS-gradient tile
      // misrepresents how the mark reads at 16px.
      <AppIconGlyph
        icon={icon}
        className="h-10 w-10 rounded-lg"
        paint={{ kind: 'solid', color: '#fff' }}
        backdrop={<rect width="64" height="64" rx="14" fill={`url(#${FAVICON_PLATE_GRADIENT_ID})`} />}
      />
    ),
  },
  {
    key: 'sidebar' as const,
    caption: 'Sidebar',
    chip: (icon: IconSetDefinition) => (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <AppIconGlyph icon={icon} className="h-4 w-4" />
      </div>
    ),
  },
  {
    key: 'login' as const,
    caption: 'Sign-in page',
    chip: (icon: IconSetDefinition) => (
      // `bg-[var(--color-card)]`, not `bg-card`: index.css makes every
      // `.bg-card` inside an animated-background subtree 45% transparent, and
      // the real sign-in card is deliberately opaque for contrast. The literal
      // class would preview the mark over a shifting mesh.
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-card)] ring-1 ring-border/60">
        <AppIconGlyph
          icon={icon}
          className="h-6 w-6"
          paint={{ kind: 'gradient', id: LOGIN_STROKE_GRADIENT_ID }}
        />
      </div>
    ),
  },
];

/**
 * Options for a per-surface override.
 *
 * The "same as app icon" entry carries the primary's own id as its value, so
 * choosing it writes a real `AppIconId` and the surface becomes
 * derived-following by equality. A sentinel like `'inherit'` would be handed
 * to `setSidebarIcon` by `ThemedSelect`'s `(value: string)` callback,
 * persisted verbatim, miss the icon lookup, and blank the sidebar or login
 * mark with no error at all.
 *
 * Exported so that invariant can be asserted directly — every option value is
 * a real `AppIconId`.
 */
export function buildOverrideOptions(primary: AppIconId): { value: AppIconId; label: string }[] {
  const primaryLabel = ICON_SET_MAP[primary]?.label ?? 'the app icon';
  return [
    { value: primary, label: `Same as app icon (${primaryLabel})` },
    ...ICON_SETS.filter((icon) => icon.id !== primary).map((icon) => ({
      value: icon.id,
      label: icon.label,
    })),
  ];
}

export function AppIconSection() {
  const faviconIcon = useThemeStore((s) => s.faviconIcon);
  const sidebarIcon = useThemeStore((s) => s.sidebarIcon);
  const loginIcon = useThemeStore((s) => s.loginIcon);
  const setAppIcon = useThemeStore((s) => s.setAppIcon);
  const setSidebarIcon = useThemeStore((s) => s.setSidebarIcon);
  const setLoginIcon = useThemeStore((s) => s.setLoginIcon);

  const overrideCount = (sidebarIcon === faviconIcon ? 0 : 1) + (loginIcon === faviconIcon ? 0 : 1);

  // Lazy initialiser, not a first-run boolean: StrictMode's mount/cleanup/mount
  // spends a flag before the user ever sees the panel. An operator arriving
  // with divergent surfaces finds the panel already open, showing their real
  // values rather than hiding them behind a closed disclosure.
  const [overridesOpen, setOverridesOpen] = useState(() => overrideCount > 0);

  // Focus is decoupled from selection: arrow keys move the roving tabindex
  // without committing. Selecting on arrow would make simple exploration
  // destructive for keyboard users, because committing rewrites the store and
  // there is no undo.
  const [focusedIndex, setFocusedIndex] = useState(() =>
    Math.max(0, ICON_SETS.findIndex((i) => i.id === faviconIcon)),
  );
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gradientHostId = useId();

  const moveFocus = useCallback((next: number) => {
    const clamped = (next + ICON_SETS.length) % ICON_SETS.length;
    setFocusedIndex(clamped);
    tileRefs.current[clamped]?.focus();
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(ICON_SETS.length - 1);
        break;
      default:
        break;
    }
  }, [moveFocus]);

  const effective: Record<'favicon' | 'sidebar' | 'login', AppIconId> = {
    favicon: faviconIcon,
    sidebar: sidebarIcon,
    login: loginIcon,
  };

  const overrideOptions = buildOverrideOptions(faviconIcon);

  return (
    <div className="mt-6 border-t border-border pt-6">
      {/* One definition for the only SVG gradient any preview needs. Hosted
          with size-zero overflow-hidden rather than `display:none`, which stops
          some engines resolving paint references into it. */}
      <svg aria-hidden="true" focusable="false" className="absolute h-0 w-0 overflow-hidden" id={gradientHostId}>
        <defs>
          <linearGradient id={LOGIN_STROKE_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="oklch(72% 0.14 244)" />
            <stop offset="100%" stopColor="oklch(78% 0.18 158)" />
          </linearGradient>
          <linearGradient id={FAVICON_PLATE_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
      </svg>

      <h3 id="app-icon-label" className="text-sm font-medium mb-1">App Icon</h3>
      <p id="app-icon-help" className="text-sm text-muted-foreground">
        Shown in the browser tab, the sidebar and on the sign-in page.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Saved in this browser only. A private window, a new profile or another machine shows the
        default Brain mark — including on the sign-in page, before anyone signs in.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="app-icon-label"
        aria-describedby="app-icon-help"
        className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3"
      >
        {ICON_SETS.map((icon, index) => {
          const checked = icon.id === faviconIcon;
          return (
            <button
              key={icon.id}
              ref={(el) => { tileRefs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              // Roving tabindex: the whole group is one tab stop.
              tabIndex={index === focusedIndex ? 0 : -1}
              onClick={() => { setAppIcon(icon.id); setFocusedIndex(index); }}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onFocus={() => setFocusedIndex(index)}
              className={cn(
                'relative flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                checked
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50',
              )}
            >
              {/* Selection is not conveyed by colour alone. */}
              {checked && (
                <Check className="absolute right-1.5 top-1.5 h-3 w-3 text-primary" aria-hidden="true" />
              )}
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
                <AppIconGlyph icon={icon} className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{icon.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">Where it appears</p>
        <div className="mt-2 flex flex-wrap gap-4" data-testid="app-icon-previews">
          {SURFACES.map((surface) => (
            <div key={surface.key} className="flex flex-col items-center gap-1">
              {surface.chip(ICON_SET_MAP[effective[surface.key]] ?? ICON_SET_MAP[faviconIcon])}
              <span className="text-[11px] text-muted-foreground">{surface.caption}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOverridesOpen((open) => !open)}
        aria-expanded={overridesOpen}
        // Only while the panel is mounted — a static aria-controls pointing at
        // an absent id is an invalid-attribute-value violation.
        {...(overridesOpen ? { 'aria-controls': 'app-icon-overrides' } : {})}
        className="mt-4 inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
        Use a different icon per surface
        {overrideCount > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{overrideCount}</span>
        )}
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', overridesOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {overridesOpen && (
        <div id="app-icon-overrides" className="mt-3 space-y-3 rounded-lg border border-border/60 p-3">
          {/* Three parallel rows, the first inert. The structure carries the
              model — browser tab always follows — instead of a sentence above
              the panel asking the reader to hold it. */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm">Browser tab</p>
              <p className="text-xs text-muted-foreground">Always uses the app icon above.</p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="icon-override-sidebar" className="text-sm">Sidebar logo</label>
              <p className="text-xs text-muted-foreground">
                Top-left brand chip, tinted with the sidebar accent.
              </p>
            </div>
            <ThemedSelect
              id="icon-override-sidebar"
              ariaLabel="Sidebar logo"
              value={sidebarIcon}
              onValueChange={(value) => setSidebarIcon(value as AppIconId)}
              options={overrideOptions}
              className="w-56 shrink-0"
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="icon-override-login" className="text-sm">Sign-in page logo</label>
              <p className="text-xs text-muted-foreground">Above the sign-in form.</p>
            </div>
            <ThemedSelect
              id="icon-override-login"
              ariaLabel="Sign-in page logo"
              value={loginIcon}
              onValueChange={(value) => setLoginIcon(value as AppIconId)}
              options={overrideOptions}
              className="w-56 shrink-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
