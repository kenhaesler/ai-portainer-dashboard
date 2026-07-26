import { useEffect, useCallback } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  NAV_CHORDS,
  breadcrumbLabelForPath,
} from '@/features/core/lib/navigation-manifest';

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: ShortcutEntry[];
}

/**
 * Chord labels are derived from the navigation manifest rather than written out
 * again here. This file used to hold a sixth independent copy of the route
 * labels, and it had already drifted — it advertised "Go to Network Topology",
 * "Go to Trace Explorer" and "Go to LLM Assistant" while the nav and breadcrumb
 * said Topology, Traces and Assistant. Deriving them means a renamed
 * destination cannot leave a stale label behind in the shortcuts overlay.
 */
const navigationShortcuts: ShortcutEntry[] = NAV_CHORDS.map(([keys, path]) => ({
  keys: keys.split(''),
  label: `Go to ${breadcrumbLabelForPath(path) ?? path}`,
}));

const categories: ShortcutCategory[] = [
  {
    title: 'Navigation (vim-style)',
    shortcuts: navigationShortcuts,
  },
  {
    title: 'Quick Actions',
    shortcuts: [
      { keys: ['r'], label: 'Refresh current page data' },
      { keys: ['t'], label: 'Cycle theme' },
      { keys: ['['], label: 'Collapse sidebar' },
      { keys: [']'], label: 'Expand sidebar' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { keys: ['?'], label: 'Show / hide this overlay' },
      { keys: ['⌘', 'K'], label: 'Open command palette' },
      { keys: ['/'], label: 'Focus search' },
      { keys: ['Esc'], label: 'Close overlay / clear search' },
    ],
  },
  {
    title: 'Table Navigation',
    shortcuts: [
      { keys: ['j'], label: 'Move down in table' },
      { keys: ['k'], label: 'Move up in table' },
      { keys: ['Enter'], label: 'Open selected row' },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsOverlay({ open, onClose }: KeyboardShortcutsOverlayProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          'relative z-50 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl',
          'animate-in fade-in-0 zoom-in-95 duration-200',
        )}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="sr-only">Close</span>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="grid max-h-[60vh] gap-6 overflow-y-auto p-6 sm:grid-cols-2">
          {categories.map((cat) => (
            <div key={cat.title}>
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">{cat.title}</h3>
              <ul className="space-y-2">
                {cat.shortcuts.map((sc) => (
                  <li key={sc.label} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{sc.label}</span>
                    <span className="ml-4 flex shrink-0 items-center gap-1">
                      {sc.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && sc.keys.length === 2 && i === 1 && (
                            <span className="text-xs text-muted-foreground">then</span>
                          )}
                          {i > 0 && sc.keys.length === 2 && i === 1 ? null : null}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 text-center text-xs text-muted-foreground">
          Press <Kbd>?</Kbd> or <Kbd>Esc</Kbd> to close
        </div>
      </div>
    </div>
  );
}
