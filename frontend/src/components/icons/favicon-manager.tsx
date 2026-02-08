import { useEffect } from 'react';
import { useThemeStore } from '@/stores/theme-store';
import { buildFaviconSvg } from './icon-sets';

export function useFaviconSync() {
  const faviconIcon = useThemeStore((s) => s.faviconIcon);

  useEffect(() => {
    const svg = buildFaviconSvg(faviconIcon);
    if (!svg) return;

    const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    // Remove ALL existing favicon links so the browser picks up the new one
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')
      .forEach((el) => el.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = href;
    document.head.appendChild(link);
  }, [faviconIcon]);
}
