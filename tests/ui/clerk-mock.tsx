'use client';

// LOCAL UI HARNESS ONLY. next.config.ts swaps '@clerk/nextjs' for this file when
// LATEWATCH_UI_HARNESS=1 in `next dev` (never in a build or on Vercel), so pages can be
// screenshotted signed in without reaching Clerk. Marker checked by tests: LATEWATCH_UI_HARNESS_CLERK_MOCK
import type { ReactNode } from 'react';

const email = 'test.admin@latewatch.test';

const user = {
  emailAddresses: [{ emailAddress: email }],
  firstName: 'Test',
  fullName: 'Test Admin',
  id: 'user_ui_harness',
  imageUrl: '',
  lastName: 'Admin',
  primaryEmailAddress: { emailAddress: email },
  publicMetadata: { role: 'admin' },
  unsafeMetadata: {},
  update: async () => user,
};

export function ClerkProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

// Hooks return the same objects on every render, as Clerk's do, so effects that depend on
// them don't loop.
const userState = { isLoaded: true, isSignedIn: true, user };
const authState = {
  getToken: async () => 'ui-harness-token',
  isLoaded: true,
  isSignedIn: true,
  sessionId: 'sess_ui_harness',
  userId: user.id,
};
const clerk = { signOut: async () => undefined };

export function useUser() {
  return userState;
}

export function useAuth() {
  return authState;
}

export function useClerk() {
  return clerk;
}

export function UserButton() {
  return (
    <button
      type="button"
      aria-label="Open user button"
      onClick={() => { document.body.dataset.userMenu = 'open'; }}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
    >
      TA
    </button>
  );
}

function Placeholder({ label }: { label: string }) {
  return <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">{label} (UI harness)</div>;
}

export function SignIn() {
  return <Placeholder label="Sign in" />;
}

export function SignUp() {
  return <Placeholder label="Sign up" />;
}
