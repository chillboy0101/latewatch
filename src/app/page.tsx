'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

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
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-4xl">⏱️</div>
        <h1 className="text-2xl font-bold">LateWatch</h1>
        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
