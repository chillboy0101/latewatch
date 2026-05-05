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
};

type DraftLocation = {
  accuracy: number | null;
  latitude: string;
  longitude: string;
};

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString();
}

function meters(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}m` : '-';
}

export default function WifiPage() {
  const [data, setData] = useState<OfficeLocationResponse | null>(null);
  const [draft, setDraft] = useState<DraftLocation>({ accuracy: null, latitude: '', longitude: '' });
  const [radiusMeters, setRadiusMeters] = useState('100');
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState('75');
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchLocation = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/attendance/location', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Location request failed (${response.status})`);
      const body = await response.json() as OfficeLocationResponse;
      setData(body);

      if (body.location) {
        setDraft((current) => current.latitude && current.longitude
          ? current
          : {
              accuracy: null,
              latitude: body.location?.latitude || '',
              longitude: body.location?.longitude || '',
            });
        setRadiusMeters(String(body.location.radiusMeters || 100));
        setMaxAccuracyMeters(String(body.location.maxAccuracyMeters || 75));
      }
    } catch (err) {
      console.error('Failed to load office location:', err);
      setError(err instanceof Error ? err.message : 'Could not load office location');
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

  async function detectCurrentLocation() {
    setDetecting(true);
    setError(null);
    setSuccess(null);

    try {
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

      setDraft({
        accuracy: position.coords.accuracy,
        latitude: position.coords.latitude.toFixed(7),
        longitude: position.coords.longitude.toFixed(7),
      });
      setSuccess('Current location detected. Review it, then save.');
    } catch (err) {
      console.error('Failed to detect office location:', err);
      setError(err instanceof Error ? err.message : 'Could not detect location');
    } finally {
      setDetecting(false);
    }
  }

  async function saveLocation() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/attendance/location', {
        body: JSON.stringify({
          latitude: draft.latitude,
          longitude: draft.longitude,
          maxAccuracyMeters,
          name: 'Office Location',
          radiusMeters,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Location update failed (${response.status})`);
      await fetchLocation();
      setSuccess('Office location updated.');
    } catch (err) {
      console.error('Failed to update office location:', err);
      setError(err instanceof Error ? err.message : 'Could not update office location');
    } finally {
      setSaving(false);
    }
  }

  const configured = Boolean(data?.configured);

  return (
    <DashboardLayout title="Office Location">
      <div className="space-y-5">
        {loading && !data ? (
          <Card>
            <LoadingBuffer variant="section" />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="p-5">
                <div className="flex min-h-36 flex-col justify-between gap-6">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border',
                      configured
                        ? 'border-success/25 bg-success/10 text-success'
                        : 'border-warning/25 bg-warning/10 text-warning',
                    )}>
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">Office Location</h2>
                      <p className="text-sm text-muted-foreground">{configured ? 'Configured' : 'Not configured'}</p>
                    </div>
                  </div>
                  <p className={cn(
                    'text-2xl font-semibold',
                    configured ? 'text-success' : 'text-warning',
                  )}>
                    {configured ? 'Ready' : 'Needs setup'}
                  </p>
                </div>
              </Card>

              <LocationInfoCard label="Saved Coordinates" value={data?.location ? `${data.location.latitude}, ${data.location.longitude}` : '-'} />
              <LocationInfoCard label="Allowed Radius" value={meters(data?.location?.radiusMeters)} meta={`Max accuracy ${meters(data?.location?.maxAccuracyMeters)}`} />
            </div>

            <Card className="p-5">
              <div className="grid gap-4 xl:grid-cols-[1fr_1fr_9rem_9rem_auto] xl:items-end">
                <Field label="Latitude">
                  <Input
                    className="h-11 font-mono"
                    inputMode="decimal"
                    value={draft.latitude}
                    onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value }))}
                    placeholder="5.6037168"
                  />
                </Field>
                <Field label="Longitude">
                  <Input
                    className="h-11 font-mono"
                    inputMode="decimal"
                    value={draft.longitude}
                    onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value }))}
                    placeholder="-0.1869644"
                  />
                </Field>
                <Field label="Radius">
                  <Input
                    className="h-11 font-mono"
                    inputMode="numeric"
                    value={radiusMeters}
                    onChange={(event) => setRadiusMeters(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </Field>
                <Field label="Accuracy">
                  <Input
                    className="h-11 font-mono"
                    inputMode="numeric"
                    value={maxAccuracyMeters}
                    onChange={(event) => setMaxAccuracyMeters(event.target.value.replace(/\D/g, '').slice(0, 3))}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button className="h-11 gap-2" variant="outline" onClick={detectCurrentLocation} disabled={detecting || saving}>
                    {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                    Detect
                  </Button>
                  <Button className="h-11 gap-2" onClick={saveLocation} disabled={saving || detecting || !draft.latitude || !draft.longitude}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Save
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Meta label="Detected Accuracy" value={meters(draft.accuracy)} />
                <Meta label="Last Updated" value={formatUpdatedAt(data?.location?.updatedAt)} />
                <Meta label="Updated By" value={data?.location?.updatedByEmail || 'Not set'} />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">Validation Policy</h3>
                    <p className="text-sm text-muted-foreground">Staff must be inside the saved radius with fresh accurate GPS evidence.</p>
                  </div>
                </div>
                <Button className="h-10 gap-2" variant="outline" onClick={refreshLocation} disabled={refreshing || loading || saving}>
                  {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
              </div>
            </Card>
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

function LocationInfoCard({ label, meta, value }: { label: string; meta?: string; value: string }) {
  return (
    <Card className="p-5" title={`${label}: ${value}`}>
      <div className="flex min-h-36 flex-col justify-between gap-6">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-3 break-all font-mono text-xl font-semibold">{value}</p>
        </div>
        <p className="text-sm text-muted-foreground">{meta || 'Office geofence'}</p>
      </div>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className="flex min-h-10 items-center rounded-md border border-border bg-background px-3 py-2">
        <span className="truncate font-mono text-xs font-semibold leading-5 text-foreground">{value}</span>
      </div>
    </div>
  );
}
