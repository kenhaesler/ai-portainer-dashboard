import { useEffect, useCallback } from 'react';

type KeyboardShortcutCallback = (event: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean; // Command key on Mac
  shiftKey?: boolean;
}

const areShortcutsEqual = (
  event: KeyboardEvent,
  shortcut: Shortcut | Shortcut[]
) => {
  const shortcuts = Array.isArray(shortcut) ? shortcut : [shortcut];

  return shortcuts.some((s) => {
    return (
      event.key.toLowerCase() === s.key.toLowerCase() &&
      (s.altKey === undefined || event.altKey === s.altKey) &&
      (s.ctrlKey === undefined || event.ctrlKey === s.ctrlKey) &&
      (s.metaKey === undefined || event.metaKey === s.metaKey) &&
      (s.shiftKey === undefined || event.shiftKey === s.shiftKey)
    );
  });
};

export function useKeyboardShortcut(
  shortcut: Shortcut | Shortcut[],
  callback: KeyboardShortcutCallback,
  dependencies: React.DependencyList = []
) {
  const memoizedCallback = useCallback(callback, dependencies);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (areShortcutsEqual(event, shortcut)) {
        event.preventDefault();
        memoizedCallback(event);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcut, memoizedCallback]);
}
