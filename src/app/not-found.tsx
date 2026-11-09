import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'Page not found' };

// An address that leads nowhere (a mistyped or old link): say so in LateWatch's own look, with a
// way back, instead of the bare default page. No logo: whoever lands here knows where they are.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <Card className="w-full max-w-[440px] rounded-xl bg-card shadow-xl">
        <CardContent className="space-y-6 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Compass className="h-6 w-6" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Page not found</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              This page doesn&apos;t exist or has moved. Head back to the main portal to carry on.
            </p>
          </div>

          <Button asChild className="w-full">
            <Link href="/">Main portal</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
