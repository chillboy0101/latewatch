import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-primary/10" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Logo and Clerk Form */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4">
        {/* Logo Mark */}
        <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
          <span className="text-xl font-bold text-primary-foreground">LW</span>
        </div>

        {/* Clerk SignIn Component */}
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          appearance={{
            layout: {
              logoPlacement: 'none',
              socialButtonsPlacement: 'bottom',
              socialButtonsVariant: 'blockButton',
            },
            variables: {
              borderRadius: '0.5rem',
              fontFamily: 'inherit',
            },
            elements: {
              rootBox: 'mx-auto w-full max-w-[400px]',
              card: 'bg-card border border-border shadow-xl rounded-xl',
              headerTitle: 'hidden',
              headerSubtitle: 'hidden',
              formButtonPrimary:
                'bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors',
              footer: 'hidden',
              socialButtonsBlockButton:
                'bg-card hover:bg-accent border border-border text-foreground rounded-lg transition-colors',
              socialButtonsProviderIcon: 'hidden',
            },
          }}
        />
      </div>
    </div>
  );
}
