import { useState, useCallback } from 'react';

const SESSION_KEY = 'dashboard-entrance-played';

export function useEntrancePlayed() {
  const [hasPlayed, setHasPlayed] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === 'true',
  );

  const markPlayed = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    setHasPlayed(true);
  }, []);

  return { hasPlayed, markPlayed };
}
