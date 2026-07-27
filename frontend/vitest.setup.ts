// Registers jest-dom's matchers on vitest's `expect` AND carries the
// `declare module 'vitest'` augmentation that types them. The older
// `expect.extend(matchers)` form registered them at runtime only, so
// `toBeInTheDocument` & co. were untyped — which mattered the moment test
// files entered the typecheck program (#1617): 2241 of the 2401 errors were
// TS2339 on matchers that do exist.
import '@testing-library/jest-dom/vitest';

import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe 0.1.0 predates vitest 2's change of augmentation point: its
// `extend-expect` entry declares `global.Vi.Assertion`, which vitest 4 no
// longer reads (and its JS half is an empty file). So the registration and the
// types are both done here — together, deliberately. Two test files used to
// call `expect.extend(axeMatchers)` locally, which left `toHaveNoViolations`
// untyped in both and available at runtime in neither of the other 243.
expect.extend(axeMatchers);
declare module 'vitest' {
  // `T = any` is not a preference — interface merging requires type parameters
  // identical to vitest's own `Assertion<T = any>`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

// Mock ResizeObserver for components that depend on it (e.g. cmdk)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock matchMedia for components using prefers-reduced-motion (e.g. KpiCard).
// We return matches:true for the reduce-motion query so animated counters
// (useCountUp) skip the rAF tween and render their target value immediately.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock scrollIntoView for jsdom (used by cmdk)
Element.prototype.scrollIntoView = function () {};

// Mock localStorage for tests
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});
