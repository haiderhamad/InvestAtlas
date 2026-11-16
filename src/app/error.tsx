'use client';

import RouteState from '@/components/layout/route-state';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteState kind="error" onRetry={reset} />;
}
