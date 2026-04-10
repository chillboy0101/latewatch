// app/(auth)/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-8 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-2xl font-bold">LW</span>
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          LateWatch
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          GRA Lateness Tracking System
        </p>
        <SignUp
          appearance={{
            elements: {
              rootBox: 'mx-auto',
              card: 'shadow-none',
              headerTitle: 'hidden',
              headerSubtitle: 'hidden',
              formButtonPrimary: 'bg-primary hover:bg-primary/90 text-primary-foreground',
              footerActionLink: 'text-primary hover:text-primary/90',
            },
          }}
        />
        <p className="mt-4 text-xs text-muted-foreground">
          Already have an account?{' '}
          <a href="/sign-in" className="text-primary hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
