'use client';

import { usePathname } from 'next/navigation';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { getWorkspaceTitle } from '@/components/layout/app-shell';

export function AppLoading() {
  const pathname = usePathname();
  const isWorkspaceRoute = Boolean(getWorkspaceTitle(pathname));

  return (
    <LoadingBuffer
      variant={isWorkspaceRoute ? 'page' : 'screen'}
      label="Loading page"
      description="Preparing the next screen."
    />
  );
}
