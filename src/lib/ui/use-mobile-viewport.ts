'use client';

import { useLayoutEffect, useState } from 'react';

export const MOBILE_VIEWPORT_QUERY = '(max-width: 768px)';

export function useMobileViewport() {
  const [isMobileViewport, setIsMobileViewport] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);

    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  return isMobileViewport;
}
