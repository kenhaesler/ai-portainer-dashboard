/**
 * Centralised animation tokens for Framer Motion.
 *
 * Every component should import from here instead of
 * hard-coding durations, easings or spring configs.
 */

/* ── Durations (seconds) ── */
export const duration = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
  slower: 0.6,
} as const;

/* ── Easing curves (cubic-bezier arrays) ── */
export const easing = {
  default: [0.4, 0, 0.2, 1] as const,
  in: [0.4, 0, 1, 1] as const,
  out: [0, 0, 0.2, 1] as const,
  pop: [0.32, 0.72, 0, 1] as const,
  spring: [0.22, 1, 0.36, 1] as const,
} as const;

/* ── Spring presets ── */
export const spring = {
  snappy: { type: 'spring' as const, stiffness: 400, damping: 25 },
  gentle: { type: 'spring' as const, stiffness: 300, damping: 30 },
  bouncy: { type: 'spring' as const, stiffness: 260, damping: 20 },
  stiff: { type: 'spring' as const, stiffness: 500, damping: 35 },
} as const;

/* ── Tween transition presets ── */
export const transition = {
  fast: { duration: duration.fast, ease: easing.default },
  base: { duration: duration.base, ease: easing.default },
  slow: { duration: duration.slow, ease: easing.spring },
  slower: { duration: duration.slower, ease: easing.spring },
  page: { duration: duration.slow, ease: easing.spring },
} as const;

/* ── Page-level variant set (enter / exit with directional blur) ── */
export const pageVariants = {
  initial: { opacity: 0, y: 10, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(4px)' },
} as const;
