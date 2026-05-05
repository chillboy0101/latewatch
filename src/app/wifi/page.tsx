'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, LocateFixed, Loader2, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type OfficeLocationResponse = {
  configured: boolean;
  currentIp: string;
  currentIpSource: string | null;
  location: {
    id: string;
    isActive: boolean | null;
    latitude: string;
    longitude: string;
    maxAccuracyMeters: number;
    name: string;
    radiusMeters: number;
    updatedAt: string | null;
    updatedByEmail: string | null;
  } | null;
  message?: string;
  storageAvailable?: boolean;
};

type DetectedLocation = {
  accuracy: number;
  latitude: number;
  longitude: number;
  timestamp: string;
};

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return 'Not saved yet';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function meters(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}m` : '-';
}

function savedPoint(location: OfficeLocationResponse['location']) {
  if (!location) return 'Not set';
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Set';
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function locationErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = Number((error as { code?: unknown }).code);
    if (code === 1) return 'Location permission was blocked. Allow location access in the browser and try again.';
    if (code === 2) return 'This device could not find its location. Move closer to a window and try again.';
    if (code === 3) return 'Location detection took too long. Try again from inside the office.';
  }

  return error instanceof Error ? error.message : 'Could not detect location.';
}

async function getCurrentBrowserLocation(): Promise<DetectedLocation> {
  if (!navigator.geolocation) {
    throw new Error('This browser does not support location detection.');
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
  });

  return {
    accuracy: position.coords.accuracy,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

export default function WifiPage() {
  const [data, setData] = useState<OfficeLocationResponse | null>(null);
  const [radiusMeters, setRadiusMeters] = useState('100');
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState('75');
  const [lastDetected, setLastDetected] = useState<DetectedLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchLocation = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/attendance/location', { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<OfficeLocationResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || `Location request failed (${response.status})`);

      setData(body as OfficeLocationResponse);

      if (body.location) {
        setRadiusMeters(String(body.location.radiusMeters || 100));
        setMaxAccuracyMeters(String(body.location.maxAccuracyMeters || 75));
      }

      if (body.storageAvailable === false && body.message) {
        setError(body.message);
      }
    } catch (err) {
      console.error('Failed to load office location:', err);
      setError(err instanceof Error ? err.message : 'Could not load office location.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'attendance',
        events: ['invalidate'],
        onEvent: fetchLocation,
      });

      if (mounted) cleanup = unsubscribe;
      else unsubscribe();
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [fetchLocation]);

  async function refreshLocation() {
    setRefreshing(true);
    setSuccess(null);
    try {
      await fetchLocation();
    } finally {
      setRefreshing(false);
    }
  }

  async function saveDetectedLocation(location: DetectedLocation) {
    const response = await fetch('/api/attendance/location', {
      body: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        maxAccuracyMeters,
        name: 'Office Location',
        radiusMeters,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || `Location update failed (${response.status})`);
  }

  async function detectAndSaveLocation() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const location = await getCurrentBrowserLocation();
      setLastDetected(location);
      await saveDetectedLocation(location);
      await fetchLocation();
      setSuccess('Office location saved. Staff check-ins will now use this office point.');
    } catch (err) {
      console.error('Failed to detect and save office location:', err);
      setError(locationErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const configured = Boolean(data?.configured);
  const location = data?.location || null;
  const setupUnavailable = data?.storageAvailable === false;

  return (
    <DashboardLayout title="Office Location">
      <div className="mx-auto max-w-4xl space-y-4">
        {loading && !data ? (
          <Card>
            <LoadingBuffer variant="section" />
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-md border',
                    setupUnavailable
                      ? 'border-danger/25 bg-danger/10 text-danger'
                      : configured
                      ? 'border-success/25 bg-success/10 text-success'
                      : 'border-warning/25 bg-warning/10 text-warning',
                  )}>
                    <MapPin className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold">Office check-in location</h2>
                      <StatusBadge configured={configured} unavailable={setupUnavailable} />
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                      Stand inside the office, allow location access, then save. LateWatch will use this point to confirm staff are at the office before check-in or check-out.
                    </p>
                  </div>
                </div>
                <Button
                  className="h-10 gap-2"
                  variant="outline"
                  onClick={refreshLocation}
                  disabled={refreshing || saving}
                >
                  {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
              </div>

              <div className="border-t border-border p-5 sm:p-6">
                <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="space-y-4">
                    <div className="rounded-md border border-border bg-background px-4 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="font-medium">{configured ? 'Saved office point is active' : 'No office location saved yet'}</p>
                        {lastDetected && (
                          <p className="text-sm text-muted-foreground">Last detection: {meters(lastDetected.accuracy)} accuracy</p>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {configured
                          ? `Last saved ${formatUpdatedAt(location?.updatedAt)}.`
                          : 'Use the button below while you are physically in the office.'}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Allowed area">
                        <div className="relative">
                          <Input
                            className="h-11 pr-12 font-mono"
                            inputMode="numeric"
                            value={radiusMeters}
                            onChange={(event) => setRadiusMeters(event.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder="100"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">m</span>
                        </div>
                      </Field>

                      <Field label="Location quality">
                        <select
                          className="flex h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          value={maxAccuracyMeters}
                          onChange={(event) => setMaxAccuracyMeters(event.target.value)}
                        >
                          <option value="50">Strict</option>
                          <option value="75">Standard</option>
                          <option value="100">Flexible</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  <Button
                    className="h-11 min-w-full gap-2 px-5 text-base sm:min-w-64"
                    onClick={detectAndSaveLocation}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
                    {configured ? 'Detect & Update Location' : 'Detect & Save Location'}
                  </Button>
                </div>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <SummaryCard
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Coverage"
                value={configured ? meters(location?.radiusMeters) : '-'}
                meta="Staff must be inside this area."
              />
              <SummaryCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                label="Saved point"
                value={configured ? 'Set' : 'Not set'}
                meta={configured ? savedPoint(location) : 'Detect while standing in the office.'}
              />
              <SummaryCard
                icon={<RefreshCw className="h-5 w-5" />}
                label="Last updated"
                value={formatUpdatedAt(location?.updatedAt)}
                meta={location?.updatedByEmail || 'Not saved yet'}
              />
            </div>
          </>
        )}

        {success && !error && (
          <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
            {success}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ configured, unavailable }: { configured: boolean; unavailable: boolean }) {
  return (
    <span className={cn(
      'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold',
      unavailable
        ? 'border-danger/25 bg-danger/10 text-danger'
        : configured
        ? 'border-success/25 bg-success/10 text-success'
        : 'border-warning/25 bg-warning/10 text-warning',
    )}>
      {unavailable ? 'Setup unavailable' : configured ? 'Ready' : 'Needs setup'}
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  meta,
  value,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold" title={value}>{value}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={meta}>{meta}</p>
        </div>
      </div>
    </Card>
  );
}
