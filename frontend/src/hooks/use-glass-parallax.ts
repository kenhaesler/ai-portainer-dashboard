import { useEffect } from 'react';

const MAX_BACKGROUND_SHIFT = 5;
const MAX_CARD_SHIFT = 1;

function setGlassParallaxVariables({
  bgX,
  bgY,
  cardX,
  cardY,
}: {
  bgX: string;
  bgY: string;
  cardX: string;
  cardY: string;
}) {
  const root = document.documentElement;
  root.style.setProperty('--glass-bg-shift-x', bgX);
  root.style.setProperty('--glass-bg-shift-y', bgY);
  root.style.setProperty('--glass-card-shift-x', cardX);
  root.style.setProperty('--glass-card-shift-y', cardY);
}

export function useGlassParallax(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      setGlassParallaxVariables({
        bgX: '0px',
        bgY: '0px',
        cardX: '0px',
        cardY: '0px',
      });
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const isTouchDevice = navigator.maxTouchPoints > 0;

    if (prefersReducedMotion || isCoarsePointer || isTouchDevice) {
      setGlassParallaxVariables({
        bgX: '0px',
        bgY: '0px',
        cardX: '0px',
        cardY: '0px',
      });
      return;
    }

    let frame = 0;

    const handleMove = (event: MouseEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        const xRatio = event.clientX / window.innerWidth - 0.5;
        const yRatio = event.clientY / window.innerHeight - 0.5;
        const bgX = `${(-xRatio * MAX_BACKGROUND_SHIFT).toFixed(2)}px`;
        const bgY = `${(-yRatio * MAX_BACKGROUND_SHIFT).toFixed(2)}px`;
        const cardX = `${(-xRatio * MAX_CARD_SHIFT).toFixed(2)}px`;
        const cardY = `${(-yRatio * MAX_CARD_SHIFT).toFixed(2)}px`;

        setGlassParallaxVariables({ bgX, bgY, cardX, cardY });
        frame = 0;
      });
    };

    window.addEventListener('mousemove', handleMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMove);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      setGlassParallaxVariables({
        bgX: '0px',
        bgY: '0px',
        cardX: '0px',
        cardY: '0px',
      });
    };
  }, [enabled]);
}
