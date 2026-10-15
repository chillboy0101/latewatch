'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LateWatchLogo } from '@/components/brand/latewatch-logo';
import { GroundsMapCard } from '@/components/location/grounds-map';
import { LiveLocationShare } from '@/components/location/live-location-share';
import { MeasureGroundsCard } from '@/components/location/measure-grounds';

// Measuring the grounds means walking them with a phone, so this admin page (admin-only through
// the proxy, like the rest of /location) skips the desktop-only dashboard shell.
export default function MeasureGroundsPage() {
  const [office, setOffice] = useState<{ latitude: number; longitude: number; radiusMeters: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/attendance/location', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const saved = body?.defaultLocation;
        const latitude = Number(saved?.latitude);
        const longitude = Number(saved?.longitude);
        if (active && Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setOffice({ latitude, longitude, radiusMeters: Number(saved.radiusMeters) || 0 });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-background px-4 pb-8 pt-4 text-foreground">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <LateWatchLogo markSize="sm" />
          <Link
            href="/check-in"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted/30"
          >
            <ArrowLeft className="h-4 w-4" />
            Portal
          </Link>
        </div>
        <GroundsMapCard office={office} />
        <LiveLocationShare />
        <MeasureGroundsCard office={office} />
      </div>
    </div>
  );
}
