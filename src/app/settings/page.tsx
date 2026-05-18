'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Moon, Sun, Monitor, Check } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { applyThemePreference, getThemePreference, subscribeThemeChange, type ThemePreference } from '@/lib/theme';

export default function SettingsPage() {
  const { user } = useUser();
  const role = (user?.publicMetadata?.role as string) || 'viewer';
  const currentTheme = useSyncExternalStore(subscribeThemeChange, getThemePreference, () => 'dark');

  const applyTheme = (theme: ThemePreference) => {
    applyThemePreference(theme);
  };

  return (
    <DashboardLayout title="Settings">
      <div className="space-y-6">
        {/* User Profile */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Account</h2>
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
              <Link href="/account" className="text-primary hover:underline">
                Account Settings
              </Link>
            </p>
          </div>
        </Card>

        {/* Preferences */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Preferences</h2>
            <div className="space-y-4">
              {/* Theme Selection */}
              <div>
                <label className="mb-2 block text-sm font-medium">Theme</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <ThemeButton variant="light" active={currentTheme === 'light'} onApply={applyTheme} />
                  <ThemeButton variant="dark" active={currentTheme === 'dark'} onApply={applyTheme} />
                  <ThemeButton variant="system" active={currentTheme === 'system'} onApply={applyTheme} />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Links */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Quick Links</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <QuickLink href="/dashboard" label="Dashboard" desc="View overview and stats" />
              <QuickLink href="/entries" label="Entries" desc="Record manual check-ins and penalties" />
              <QuickLink href="/staff" label="Staff Management" desc="Manage staff members" />
              <QuickLink href="/exports" label="Lateness Exports" desc="Generate reports" />
              <QuickLink href="/calendar" label="Calendar" desc="View holidays" />
            </div>
          </div>
        </Card>

        {/* Session */}
        <Card>
          <div className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Session</h2>
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

function ThemeButton({ variant, active, onApply }: { variant: ThemePreference; active: boolean; onApply: (t: ThemePreference) => void }) {
  const icons = { light: Sun, dark: Moon, system: Monitor };
  const Icon = icons[variant];

  return (
    <button
      onClick={() => onApply(variant)}
      className={`flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background hover:bg-card'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="capitalize">{variant}</span>
      {active && <Check className="h-4 w-4 text-primary" />}
    </button>
  );
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-card transition-colors"
    >
      <div className="mt-0.5 h-2 w-2 rounded-full bg-primary" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </Link>
  );
}
