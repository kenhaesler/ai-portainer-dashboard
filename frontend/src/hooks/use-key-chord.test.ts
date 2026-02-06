import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyChord } from './use-key-chord';
import type { ChordBinding } from './use-key-chord';

function fireKey(key: string, options: Partial<KeyboardEvent> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  window.dispatchEvent(event);
}

describe('useKeyChord', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fire action on two-key chord', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    fireKey('h');

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should not fire if second key is wrong', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    fireKey('x');

    expect(action).not.toHaveBeenCalled();
  });

  it('should not fire after timeout expires', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    vi.advanceTimersByTime(600); // past 500ms timeout
    fireKey('h');

    expect(action).not.toHaveBeenCalled();
  });

  it('should fire correct action from multiple bindings', () => {
    const homeAction = vi.fn();
    const workloadsAction = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action: homeAction, label: 'Go Home' },
      { keys: 'gw', action: workloadsAction, label: 'Go Workloads' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    fireKey('w');

    expect(homeAction).not.toHaveBeenCalled();
    expect(workloadsAction).toHaveBeenCalledTimes(1);
  });

  it('should ignore keys with modifier keys', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('g', { metaKey: true });
    fireKey('h');

    expect(action).not.toHaveBeenCalled();
  });

  it('should ignore keys when focus is in input element', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    fireKey('h');

    expect(action).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('should ignore keys when focus is in textarea element', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    fireKey('h');

    expect(action).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('should handle uppercase keys by normalizing to lowercase', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('G');
    fireKey('H');

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should clean up event listener on unmount', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    const { unmount } = renderHook(() => useKeyChord(bindings));

    unmount();

    fireKey('g');
    fireKey('h');

    expect(action).not.toHaveBeenCalled();
  });

  it('should not treat non-prefix keys as chord starters', () => {
    const action = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action, label: 'Go Home' },
    ];

    renderHook(() => useKeyChord(bindings));

    // 'x' is not a prefix of any binding
    fireKey('x');
    fireKey('h');

    expect(action).not.toHaveBeenCalled();
  });

  it('should allow successive chords', () => {
    const homeAction = vi.fn();
    const workloadsAction = vi.fn();
    const bindings: ChordBinding[] = [
      { keys: 'gh', action: homeAction, label: 'Go Home' },
      { keys: 'gw', action: workloadsAction, label: 'Go Workloads' },
    ];

    renderHook(() => useKeyChord(bindings));

    fireKey('g');
    fireKey('h');
    fireKey('g');
    fireKey('w');

    expect(homeAction).toHaveBeenCalledTimes(1);
    expect(workloadsAction).toHaveBeenCalledTimes(1);
  });
});
