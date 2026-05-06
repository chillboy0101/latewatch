'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Crosshair,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type SavedOfficeLocation = {
  archivedAt: string | null;
  formattedAddress: string | null;
  googlePlaceId: string | null;
  id: string;
  isActive: boolean | null;
  latitude: string;
  locationKind: 'default' | 'scheduled' | string;
  longitude: string;
  maxAccuracyMeters: number;
  name: string;
  radiusMeters: number;
  scheduleEndDate: string | null;
  scheduleStartDate: string | null;
  source: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
};

type OfficeLocationResponse = {
  configured: boolean;
  currentIp: string;
  currentIpSource: string | null;
  date: string | null;
  defaultLocation: SavedOfficeLocation | null;
  location: SavedOfficeLocation | null;
  message?: string;
  scheduledLocations: SavedOfficeLocation[];
  storageAvailable?: boolean;
};

type DraftLocation = {
  formattedAddress: string | null;
  googlePlaceId: string | null;
  latitude: number;
  longitude: number;
  name: string;
  source: string;
};

type SaveMode = 'default' | 'scheduled';

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function coordinateLabel(location: DraftLocation | SavedOfficeLocation | null | undefined) {
  if (!location) return 'Not set';
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Set';
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function savedToDraft(location: SavedOfficeLocation | null | undefined): DraftLocation | null {
  if (!location) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    formattedAddress: location.formattedAddress,
    googlePlaceId: location.googlePlaceId,
    latitude,
    longitude,
    name: location.name,
    source: location.source || 'detected',
  };
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

async function getCurrentBrowserLocation(): Promise<DraftLocation> {
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
    formattedAddress: null,
    googlePlaceId: null,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    name: 'Detected location',
    source: 'detected',
  };
}

export default function WifiPage() {
  const [data, setData] = useState<OfficeLocationResponse | null>(null);
  const [draft, setDraft] = useState<DraftLocation | null>(null);
  const [mode, setMode] = useState<SaveMode>('default');
  const [radiusMeters, setRadiusMeters] = useState('75');
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState('75');
  const [scheduleStartDate, setScheduleStartDate] = useState(dateKey());
  const [scheduleEndDate, setScheduleEndDate] = useState(dateKey());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resolvedLocation = data?.location || null;
  const defaultLocation = data?.defaultLocation || null;
  const scheduledLocations = data?.scheduledLocations || [];
  const configured = Boolean(data?.configured);
  const setupUnavailable = data?.storageAvailable === false;
  const savedDefaultDraft = useMemo(() => savedToDraft(defaultLocation), [defaultLocation]);
  const activeDraft = useMemo(
    () => draft || (mode === 'default' ? savedDefaultDraft : null),
    [draft, mode, savedDefaultDraft],
  );
  const currentLocationLabel = resolvedLocation?.name || defaultLocation?.name || 'No location saved';
  const currentLocationMeta = resolvedLocation
    ? `Active today: ${resolvedLocation.name}`
    : defaultLocation
    ? 'Default office saved'
    : 'Detect and save the office location.';

  const fetchLocation = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch(`/api/attendance/location?date=${dateKey()}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<OfficeLocationResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || `Location request failed (${response.status})`);

      setData(body as OfficeLocationResponse);

      const incomingDefault = body.defaultLocation || null;
      if (incomingDefault) {
        setRadiusMeters(String(incomingDefault.radiusMeters || 75));
        setMaxAccuracyMeters(String(incomingDefault.maxAccuracyMeters || 75));
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

  async function detectCurrentLocation() {
    setDetecting(true);
    setError(null);
    setSuccess(null);

    try {
      const location = await getCurrentBrowserLocation();
      setDraft({
        ...location,
        name: mode === 'scheduled' ? 'Program Location' : 'Office Location',
      });
      setSuccess('Location detected. Review the details, then save.');
    } catch (err) {
      console.error('Failed to detect office location:', err);
      setError(locationErrorMessage(err));
    } finally {
      setDetecting(false);
    }
  }

  async function saveLocation() {
    if (!activeDraft) {
      setError('Detect this device location first, then save it.');
      return;
    }

    if (mode === 'scheduled' && (!scheduleStartDate || !scheduleEndDate)) {
      setError('Choose the start and end dates for this program location.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/attendance/location', {
        body: JSON.stringify({
          formattedAddress: null,
          googlePlaceId: null,
          latitude: activeDraft.latitude,
          longitude: activeDraft.longitude,
          maxAccuracyMeters,
          mode,
          name: activeDraft.name || (mode === 'scheduled' ? 'Program Location' : 'Office Location'),
          radiusMeters,
          scheduleEndDate: mode === 'scheduled' ? scheduleEndDate : null,
          scheduleStartDate: mode === 'scheduled' ? scheduleStartDate : null,
          source: 'detected',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Location update failed (${response.status})`);

      await fetchLocation();
      setDraft(null);
      setSuccess(mode === 'scheduled'
        ? 'Program location saved. It will override the office on the scheduled dates.'
        : 'Default office location saved.');
    } catch (err) {
      console.error('Failed to save office location:', err);
      setError(err instanceof Error ? err.message : 'Could not save location.');
    } finally {
      setSaving(false);
    }
  }

  function selectMode(nextMode: SaveMode) {
    setMode(nextMode);
    setDraft((current) => {
      if (!current) return current;
      if (current.name !== 'Office Location' && current.name !== 'Program Location') return current;
      return {
        ...current,
        name: nextMode === 'scheduled' ? 'Program Location' : 'Office Location',
      };
    });
  }

  return (
    <DashboardLayout title="Office Location">
      <div className="mx-auto max-w-3xl space-y-4">
        {loading && !data ? (
          <Card>
            <LoadingBuffer variant="section" />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border',
                  setupUnavailable
                    ? 'border-danger/25 bg-danger/10 text-danger'
                    : configured
                    ? 'border-success/25 bg-success/10 text-success'
                    : 'border-warning/25 bg-warning/10 text-warning',
                )}>
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">Office location</h2>
                    <StatusBadge configured={configured} unavailable={setupUnavailable} />
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Stand at the location, detect it, then save.
                  </p>
                </div>
              </div>
              <Button className="h-10 shrink-0 gap-2" variant="outline" onClick={refreshLocation} disabled={refreshing || saving || detecting}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Current setting</p>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" title={currentLocationLabel}>{currentLocationLabel}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{currentLocationMeta}</p>
                  </div>
                  {scheduledLocations.length > 0 && (
                    <p className="shrink-0 text-sm text-muted-foreground">
                      {scheduledLocations.length} program {scheduledLocations.length === 1 ? 'schedule' : 'schedules'}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ModeButton active={mode === 'default'} icon={<MapPin className="h-4 w-4" />} onClick={() => selectMode('default')}>
                  Default office
                </ModeButton>
                <ModeButton active={mode === 'scheduled'} icon={<CalendarDays className="h-4 w-4" />} onClick={() => selectMode('scheduled')}>
                  Program
                </ModeButton>
              </div>

              {mode === 'scheduled' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Program starts">
                    <Input className="h-11" type="date" value={scheduleStartDate} onChange={(event) => setScheduleStartDate(event.target.value)} />
                  </Field>
                  <Field label="Program ends">
                    <Input className="h-11" type="date" value={scheduleEndDate} onChange={(event) => setScheduleEndDate(event.target.value)} />
                  </Field>
                </div>
              )}

              <div className="rounded-md border border-dashed border-border bg-background p-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <Crosshair className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">
                  {activeDraft ? 'Location ready' : 'Detect this location'}
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  {activeDraft
                    ? 'Review the name below, then save it for attendance checks.'
                    : 'Allow location access when the browser asks. Run this while standing at the exact place staff should check in.'}
                </p>
                <Button className="mt-5 h-11 gap-2" onClick={detectCurrentLocation} disabled={detecting || saving}>
                  {detecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
                  Detect Current Location
                </Button>
              </div>

              {activeDraft && (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
                  <Field label="Location name">
                    <Input
                      className="h-11"
                      disabled={saving}
                      value={activeDraft.name || ''}
                      onChange={(event) => setDraft((current) => {
                        const base = current || activeDraft;
                        if (!base) return current;
                        return { ...base, name: event.target.value };
                      })}
                      placeholder={mode === 'scheduled' ? 'Program Location' : 'Office Location'}
                    />
                  </Field>
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Point</p>
                    <p className="mt-1 break-words font-mono text-sm font-semibold">{coordinateLabel(activeDraft)}</p>
                  </div>
                </div>
              )}

              <details className="group rounded-md border border-border bg-background">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
                  Optional settings
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
                  <Field label="Attendance area">
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
              </details>

              <Button className="h-11 w-full gap-2 text-base" onClick={saveLocation} disabled={saving || detecting || !activeDraft}>
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                Save Location
              </Button>
            </div>
          </Card>
        )}

        {success && !error && (
          <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
            {success}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
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

function ModeButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-card',
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {children}
    </button>
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
