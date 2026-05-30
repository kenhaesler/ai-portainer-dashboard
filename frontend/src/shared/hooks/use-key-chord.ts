import { useEffect, useRef, useCallback } from 'react';

interface ChordBinding {
  keys: string; // e.g. "gh" for g then h
  action: () => void;
  label: string;
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

export function useKeyChord(bindings: ChordBinding[]) {
  const prefixRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (isEditableElement(document.activeElement)) return;
      // Don't capture modifier keys
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (prefixRef.current) {
        // Second key in chord
        const chord = prefixRef.current + key;
        const binding = bindings.find((b) => b.keys === chord);
        prefixRef.current = null;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (binding) {
          e.preventDefault();
          binding.action();
        }
        return;
      }

      // Check if this is a chord prefix (first character of any binding)
      const isPrefix = bindings.some((b) => b.keys[0] === key && b.keys.length === 2);
      if (isPrefix) {
        e.preventDefault();
        prefixRef.current = key;
        // Reset after 500ms
        timeoutRef.current = setTimeout(() => {
          prefixRef.current = null;
        }, 500);
      }
    },
    [bindings],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [handleKeyDown]);
}

export type { ChordBinding };
