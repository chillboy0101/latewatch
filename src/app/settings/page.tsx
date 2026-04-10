// app/settings/page.tsx
'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Moon, Sun, Monitor } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useUser();
  const role = (user?.publicMetadata?.role as string) || 'viewer';

  return (
    <DashboardLayout title="Settings">
      <div className="space-y-6">
        {/* User Profile - View Only (Clerk handles editing) */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">ACCOUNT</h2>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <UserButton />
              <div className="flex-1">
                <p className="font-medium">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</p>
                <p className="text-sm text-muted-foreground">{user?.primaryEmailAddress?.emailAddress}</p>
                <div className="mt-1 inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  {role.toUpperCase()}
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              To change your name, email, or password, visit the{' '}
              <a href="/account" className="text-primary hover:underline">
                Clerk Account Settings
              </a>
            </p>
          </div>
        </Card>

        {/* Preferences */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">PREFERENCES</h2>
            <div className="space-y-4">
              {/* Theme Selection */}
              <div>
                <label className="mb-2 block text-sm font-medium">Theme</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <ThemeButton variant="light" />
                  <ThemeButton variant="dark" />
                  <ThemeButton variant="system" />
                </div>
              </div>

              {/* Default Date View */}
              <div>
                <label className="mb-2 block text-sm font-medium">Default Date View</label>
                <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <option>Today</option>
                  <option>This Week</option>
                  <option>This Month</option>
                </select>
              </div>

              {/* Default Export Format */}
              <div>
                <label className="mb-2 block text-sm font-medium">Default Export Format</label>
                <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <option>Weekly</option>
                  <option>Monthly</option>
                </select>
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Links */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">QUICK LINKS</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <QuickLink href="/dashboard" label="Dashboard" desc="View overview and stats" />
              <QuickLink href="/entries" label="Daily Entries" desc="Record lateness data" />
              <QuickLink href="/staff" label="Staff Management" desc="Manage staff members" />
              <QuickLink href="/exports" label="Export Center" desc="Generate reports" />
              <QuickLink href="/calendar" label="Calendar" desc="View holidays" />
            </div>
          </div>
        </Card>

        {/* Session */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">SESSION</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Signed in as {user?.primaryEmailAddress?.emailAddress}
            </p>
            <Button variant="outline" onClick={() => window.location.href = '/sign-in'}>
              Sign Out
            </Button>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function ThemeButton({ variant }: { variant: 'light' | 'dark' | 'system' }) {
  const icons = { light: Sun, dark: Moon, system: Monitor };
  const Icon = icons[variant];
  
  return (
    <button className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-card">
      <Icon className="h-4 w-4" />
      <span className="capitalize">{variant}</span>
    </button>
  );
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <a
      href={href}
      className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-card"
    >
      <div className="mt-0.5 h-2 w-2 rounded-full bg-primary" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </a>
  );
}
