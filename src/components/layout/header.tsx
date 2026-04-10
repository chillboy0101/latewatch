// components/layout/header.tsx
'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { Bell, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

interface HeaderProps {
  title?: string;
  userRole?: string;
}

export function Header({ title, userRole }: HeaderProps) {
  const { user } = useUser();
  const firstName = user?.firstName || 'User';
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check initial theme
    const isDarkMode = document.documentElement.classList.contains('dark');
    setIsDark(isDarkMode);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-xl font-semibold">{title}</h1>}
      </div>
      <div className="flex items-center gap-4">
        {/* Theme Toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        {/* Notifications */}
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>
        {/* User */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-sm text-muted-foreground">
            {firstName}
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
