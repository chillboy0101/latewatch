'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, KeyRound, Lock, Shield } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const CLERK_DASHBOARD_URL = 'https://dashboard.clerk.com/';

export default function SecuritySettingsPage() {
  return (
    <DashboardLayout title="Security">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security Hardening</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Device locking is active. MFA and passkeys should be enforced from Clerk so account sharing becomes much harder.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-semibold">Device Locking</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Trusted attendance device rules are enforced in LateWatch.</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-semibold">Session Cleanup</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Reset and approved transfer flows revoke old Clerk sessions.</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-warning">
              <KeyRound className="h-4 w-4" />
              <span className="text-sm font-semibold">MFA / Passkeys</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Enable from Clerk before requiring it for every staff member.</p>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Recommended Clerk Settings</h2>
            </div>
          </div>
          <div className="grid gap-3 p-5">
            <SecurityStep
              icon={<KeyRound className="h-4 w-4" />}
              title="Require a second factor for staff sign-in"
              body="Turn on Clerk multi-factor authentication for the LateWatch app. Start with admins first, then require it for staff after everyone has enrolled."
            />
            <SecurityStep
              icon={<Shield className="h-4 w-4" />}
              title="Enable passkeys where available"
              body="Passkeys reduce password sharing because the trusted phone or computer must approve the sign-in."
            />
            <SecurityStep
              icon={<CheckCircle2 className="h-4 w-4" />}
              title="Keep LateWatch device controls enabled"
              body="Attendance device reset, transfer approval, push subscription cleanup, and session revocation should remain active."
            />
          </div>
          <div className="flex items-center gap-2 border-t border-border p-5">
            <Button asChild className="gap-2">
              <Link href={CLERK_DASHBOARD_URL} target="_blank" rel="noreferrer">
                <KeyRound className="h-4 w-4" />
                Open Clerk Dashboard
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/attendance/security-alerts">Review Security Alerts</Link>
            </Button>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SecurityStep({ body, icon, title }: { body: string; icon: ReactNode; title: string }) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-background p-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
