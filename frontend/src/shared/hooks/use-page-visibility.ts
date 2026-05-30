import { useEffect, useState } from 'react';

function isPageVisible() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState<boolean>(() => isPageVisible());

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(isPageVisible());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
