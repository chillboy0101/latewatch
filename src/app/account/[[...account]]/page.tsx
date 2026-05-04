import { UserProfile } from '@clerk/nextjs';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';

export default function AccountPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <LateWatchLogo markSize="sm" />
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Main Portal
        </Link>
      </div>

      <div className="mx-auto mt-6 flex w-full max-w-5xl justify-center">
        <UserProfile routing="path" path="/account" />
      </div>
    </main>
  );
}
