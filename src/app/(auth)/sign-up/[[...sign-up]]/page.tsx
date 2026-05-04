import { AuthWatermark } from '@/components/auth/auth-watermark';
import { ClerkAuthCard } from '@/components/auth/clerk-auth-card';
import { InviteOnlySignUpCard } from '@/components/auth/invite-only-sign-up-card';

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const INVITATION_PARAM_NAMES = [
  '__clerk_ticket',
  '__clerk_invitation_token',
  'ticket',
  'invitation_token',
];

function hasInvitationParam(searchParams: Record<string, string | string[] | undefined>) {
  return INVITATION_PARAM_NAMES.some((paramName) => Boolean(searchParams[paramName]));
}

export default async function Page({ searchParams }: SignUpPageProps) {
  const resolvedSearchParams = await searchParams;
  const canSignUp = resolvedSearchParams ? hasInvitationParam(resolvedSearchParams) : false;

  return (
    <div className="relative min-h-dvh w-screen overflow-hidden bg-background">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-primary/10" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <AuthWatermark />

      {/* Clerk SignUp Component - centered */}
      <div className="relative z-10 flex min-h-dvh w-full items-center justify-center px-4 py-6">
        {canSignUp ? <ClerkAuthCard mode="sign-up" /> : <InviteOnlySignUpCard />}
      </div>
    </div>
  );
}
