import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function InviteOnlySignUpCard() {
  return (
    <Card className="w-full max-w-[400px] rounded-xl bg-card/95 shadow-xl backdrop-blur">
      <CardContent className="space-y-6 p-6 text-center">
        <LateWatchLogo className="justify-center" markSize="lg" />

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Invite Only</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            LateWatch accounts are created by an administrator. Ask your admin to add your staff email, then sign in with that email.
          </p>
        </div>

        <div className="grid gap-2">
          <Button asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Main portal</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
