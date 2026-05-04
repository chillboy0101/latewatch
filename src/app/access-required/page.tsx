import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function AccessRequiredPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <Card className="w-full max-w-[440px] rounded-xl bg-card shadow-xl">
        <CardContent className="space-y-6 p-6 text-center">
          <LateWatchLogo className="justify-center" markSize="lg" />

          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
            <ShieldAlert className="h-6 w-6" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Account Access Needed</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              This account is not active in the LateWatch organization. Ask an administrator to add your staff login email, then sign in again.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild>
              <Link href="/sign-in">Sign in again</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Main portal</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
