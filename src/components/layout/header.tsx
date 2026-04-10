// components/layout/header.tsx
'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  title?: string;
  userRole?: string;
}

export function Header({ title, userRole }: HeaderProps) {
  const { user } = useUser();
  const firstName = user?.firstName || 'User';

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-xl font-semibold">{title}</h1>}
      </div>
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Good {getTimeOfDay()}, {firstName}
          </span>
          {userRole && (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {userRole.toUpperCase()}
            </span>
          )}
          <UserButton />
        </div>
      </div>
    </header>
  );
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
