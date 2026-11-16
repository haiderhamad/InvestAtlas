'use client';

import { useEffect, useState } from 'react';

export function useReducedMotion() {
  // Keep the first render static until the browser preference is known.
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return reducedMotion;
}
