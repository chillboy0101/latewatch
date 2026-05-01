'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { LoadingBuffer } from '@/components/ui/loading-buffer';

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded) {
      if (isSignedIn) {
        router.push('/dashboard');
      } else {
        router.push('/sign-in');
      }
    }
  }, [isLoaded, isSignedIn, router]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <LoadingBuffer
        variant="screen"
        label="Opening LateWatch"
        description="Checking your session and preparing the workspace."
      />
    </div>
  );
}
