'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, Crosshair, Loader2, MapPin, Save, Undo2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { MAP_COLORS, OfficeMap, type MapPoint, type MapTapMode } from '@/components/location/office-map';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import {
  DEFAULT_BOUNDARY_ROOM_METERS,
  DEFAULT_ROAD_ALLOWANCE_METERS,
  type LatLng,
  type OfficeBoundary,
} from '@/lib/office-boundary';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

// Office Location: where staff can sign in. The map shows the area in force (the office
// boundary, or the circle around the pin) and any proposed boundary. A boundary is drawn on the
// map, proposed, and only used for sign-in once an admin taps "Use this boundary".

type SavedOfficeLocation = {
  id: string;
  latitude: string;
  locationKind: 'default' | 'scheduled' | string;
  longitude: string;
  maxAccuracyMeters: number;
  name: string;
  radiusMeters: number;
  scheduleEndDate: string | null;
  scheduleStartDate: string | null;
};

type OfficeLocationResponse = {
  configured: boolean;
  defaultLocation: SavedOfficeLocation | null;
  location: SavedOfficeLocation | null;
  message?: string;
  storageAvailable?: boolean;
};

type Boundaries = { active: OfficeBoundary | null; draft: OfficeBoundary | null };
type BoundaryAction = 'approve' | 'discard' | 'propose' | 'remove';
type PinMode = 'default' | 'scheduled';

const EDITOR_STORAGE_KEY = 'latewatch.boundary-editor.v1';
const MAX_CORNERS = 60;
const BOUNDARY_NOTICES: Record<BoundaryAction, string> = {
  approve: 'The office boundary is on. Sign-ins follow it from now.',
  discard: 'Proposed boundary removed.',
  propose: 'Boundary proposed. Check the cyan line on the map, then tap Use this boundary.',
  remove: 'Back to the circle for sign-in.',
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const withId = (point: LatLng): MapPoint => ({ id: newId(), latitude: point.latitude, longitude: point.longitude });

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function describeBoundary(boundary: OfficeBoundary) {
  return `${boundary.outline.length} corners, ${boundary.roomMeters} m room for phone error${boundary.road ? `, stops ${boundary.road.allowanceMeters} m past the road` : ''}`;
}

function readEditor(): { corners: MapPoint[]; roadPoints: MapPoint[] } {
  try {
    const stored = JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) || '{}');
    const points = (value: unknown) => (Array.isArray(value)
      ? value.filter((point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)).map(withId)
      : []);
    return { corners: points(stored.corners).slice(0, MAX_CORNERS), roadPoints: points(stored.roadPoints).slice(-2) };
  } catch {
    return { corners: [], roadPoints: [] };
  }
}

function locationErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = Number((error as { code?: unknown }).code);
    if (code === 1) return 'Location permission was blocked. Allow location access in the browser and try again.';
    if (code === 2) return 'This device could not find its location. Pick the pin on the map instead.';
    if (code === 3) return 'Finding this device took too long. Pick the pin on the map instead.';
  }
  return error instanceof Error ? error.message : 'Could not find this device.';
}

function detectDevice(): Promise<LatLng> {
  if (!navigator.geolocation) return Promise.reject(new Error('This browser cannot find its location. Pick the pin on the map instead.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      reject,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}

export default function LocationPage() {
  const [data, setData] = useState<OfficeLocationResponse | null>(null);
  const [boundaries, setBoundaries] = useState<Boundaries>({ active: null, draft: null });
  const [loading, setLoading] = useState(true);
  const [tapMode, setTapMode] = useState<MapTapMode>('corner');
  const [corners, setCorners] = useState<MapPoint[]>([]);
  const [roadPoints, setRoadPoints] = useState<MapPoint[]>([]);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [roomMeters, setRoomMeters] = useState(String(DEFAULT_BOUNDARY_ROOM_METERS));
  const [roadAllowanceMeters, setRoadAllowanceMeters] = useState(String(DEFAULT_ROAD_ALLOWANCE_METERS));
  const [pinMode, setPinMode] = useState<PinMode>('default');
  const [pinDraft, setPinDraft] = useState<LatLng | null>(null);
  const [programName, setProgramName] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('90');
  const [maxAccuracyMeters, setMaxAccuracyMeters] = useState('100');
  const [scheduleStartDate, setScheduleStartDate] = useState(dateKey());
  const [scheduleEndDate, setScheduleEndDate] = useState(dateKey());
  const [busy, setBusy] = useState<BoundaryAction | 'detect' | 'save-pin' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Radius and quality being typed: live updates (every sign-in) must not reset them.
  const limitsEditedRef = useRef(false);

  const defaultLocation = data?.defaultLocation || null;
  const todayLocation = data?.location || null;
  const officePin = defaultLocation
    ? { latitude: Number(defaultLocation.latitude), longitude: Number(defaultLocation.longitude), radiusMeters: defaultLocation.radiusMeters }
    : null;
  const pinValid = officePin && Number.isFinite(officePin.latitude) && Number.isFinite(officePin.longitude) ? officePin : null;
  const programToday = todayLocation?.locationKind === 'scheduled' ? todayLocation : null;

  const fetchAll = useCallback(async () => {
    try {
      const [locationResponse, boundaryResponse] = await Promise.all([
        fetch(`/api/attendance/location?date=${dateKey()}`, { cache: 'no-store' }),
        fetch('/api/attendance/location/boundary', { cache: 'no-store' }),
      ]);
      const body = await locationResponse.json().catch(() => ({})) as Partial<OfficeLocationResponse> & { error?: string };
      if (!locationResponse.ok) throw new Error(body.error || `Location request failed (${locationResponse.status})`);
      setData(body as OfficeLocationResponse);
      const incoming = body.defaultLocation || null;
      if (incoming && !limitsEditedRef.current) {
        setRadiusMeters(String(incoming.radiusMeters || 90));
        setMaxAccuracyMeters(String(incoming.maxAccuracyMeters || 100));
      }
      if (body.storageAvailable === false && body.message) setError(body.message);
      const boundaryBody = boundaryResponse.ok ? await boundaryResponse.json().catch(() => null) : null;
      if (boundaryBody) setBoundaries({ active: boundaryBody.active ?? null, draft: boundaryBody.draft ?? null });
    } catch (err) {
      console.error('Failed to load office location:', err);
      setError(err instanceof Error ? err.message : 'Could not load office location.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;
    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({ channel: 'attendance', events: ['invalidate'], onEvent: fetchAll });
      if (mounted) cleanup = unsubscribe;
      else unsubscribe();
    })();
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [fetchAll]);

  // Corners being drawn survive a reload (kept in this browser only).
  useEffect(() => {
    const stored = readEditor();
    setCorners(stored.corners);
    setRoadPoints(stored.roadPoints);
    setEditorLoaded(true);
  }, []);
  useEffect(() => {
    if (!editorLoaded) return;
    try {
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({ corners, roadPoints }));
    } catch {
      // Storage blocked: the drawing stays on screen for this visit.
    }
  }, [corners, editorLoaded, roadPoints]);

  const handleTap = useCallback((point: LatLng) => {
    setNotice(null);
    if (tapMode === 'pin') {
      setPinDraft(point);
      return;
    }
    if (tapMode === 'road') {
      setRoadPoints((current) => [...current, withId(point)].slice(-2));
      return;
    }
    setCorners((current) => (current.length >= MAX_CORNERS ? current : [...current, withId(point)]));
  }, [tapMode]);

  const handleMove = useCallback((kind: 'corner' | 'road', id: string, point: LatLng) => {
    const update = (current: MapPoint[]) => current.map((item) => (item.id === id ? { ...item, ...point } : item));
    if (kind === 'road') setRoadPoints(update);
    else setCorners(update);
  }, []);

  async function boundaryAction(action: BoundaryAction) {
    const confirmText = action === 'approve'
      ? 'Use this boundary for every sign-in from now on?'
      : action === 'remove' ? 'Go back to the circle for sign-in?' : null;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const boundary = action === 'propose'
        ? {
            outline: corners.map(({ latitude, longitude }) => ({ latitude, longitude })),
            road: roadPoints.length === 2
              ? { allowanceMeters: Number(roadAllowanceMeters), from: roadPoints[0], to: roadPoints[1] }
              : null,
            roomMeters: Number(roomMeters),
          }
        : undefined;
      const response = await fetch('/api/attendance/location/boundary', {
        body: JSON.stringify({ action, boundary }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not update the boundary (${response.status})`);
      setBoundaries({ active: body.active ?? null, draft: body.draft ?? null });
      if (action === 'propose') {
        setCorners([]);
        setRoadPoints([]);
      }
      setNotice(BOUNDARY_NOTICES[action]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update the boundary');
    } finally {
      setBusy(null);
    }
  }

  // Start from the proposed (or current) boundary to adjust it.
  function editExisting() {
    const source = boundaries.draft || boundaries.active;
    if (!source) return;
    setCorners(source.outline.map(withId));
    setRoadPoints(source.road ? [withId(source.road.from), withId(source.road.to)] : []);
    setRoomMeters(String(source.roomMeters));
    if (source.road) setRoadAllowanceMeters(String(source.road.allowanceMeters));
    setTapMode('corner');
    setNotice(null);
  }

  function clearDrawing() {
    if ((corners.length > 0 || roadPoints.length > 0) && !window.confirm('Clear the corners and road edge you drew?')) return;
    setCorners([]);
    setRoadPoints([]);
  }

  async function useThisDevice() {
    setBusy('detect');
    setError(null);
    try {
      setPinDraft(await detectDevice());
    } catch (detectError) {
      setError(locationErrorMessage(detectError));
    } finally {
      setBusy(null);
    }
  }

  async function savePin() {
    const point = pinDraft || (pinMode === 'default' ? pinValid : null);
    if (!point) {
      setError('Pick the pin on the map first.');
      return;
    }
    setBusy('save-pin');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/attendance/location', {
        body: JSON.stringify({
          latitude: point.latitude,
          longitude: point.longitude,
          maxAccuracyMeters,
          mode: pinMode,
          name: pinMode === 'scheduled' ? programName.trim() || 'Program Location' : 'Office Location',
          radiusMeters,
          scheduleEndDate: pinMode === 'scheduled' ? scheduleEndDate : null,
          scheduleStartDate: pinMode === 'scheduled' ? scheduleStartDate : null,
          source: pinDraft ? 'map' : 'manual',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Location update failed (${response.status})`);
      limitsEditedRef.current = false;
      setPinDraft(null);
      if (tapMode === 'pin') setTapMode('corner');
      await fetchAll();
      setNotice(pinMode === 'scheduled' ? 'Program location saved.' : 'Office pin and circle saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the location.');
    } finally {
      setBusy(null);
    }
  }

  const status = data?.storageAvailable === false
    ? { className: 'border-danger/25 bg-danger/10 text-danger', label: 'Setup unavailable' }
    : !data?.configured
      ? { className: 'border-warning/25 bg-warning/10 text-warning', label: 'Needs setup' }
      : boundaries.active
        ? { className: 'border-success/25 bg-success/10 text-success', label: 'Boundary on' }
        : { className: 'border-primary/25 bg-primary/10 text-primary', label: 'Circle' };

  const legend = [
    boundaries.active ? { color: MAP_COLORS.active, label: 'Office boundary' } : { color: MAP_COLORS.active, dashed: true, label: 'Circle' },
    boundaries.draft ? { color: MAP_COLORS.draft, label: 'Proposed' } : null,
    corners.length > 0 ? { color: MAP_COLORS.corners, label: 'Your drawing' } : null,
    boundaries.active?.road || boundaries.draft?.road || roadPoints.length > 0 ? { color: MAP_COLORS.road, label: 'Road edge' } : null,
    pinDraft ? { color: MAP_COLORS.pinDraft, label: 'New pin' } : null,
  ].filter((item): item is { color: string; dashed?: boolean; label: string } => Boolean(item));

  const hint = tapMode === 'pin'
    ? 'Click the map where the pin should go.'
    : tapMode === 'road'
      ? 'Click 2 points along the road edge in front of the grounds.'
      : 'Click each corner of the grounds in order. Drag a number to adjust.';

  return (
    <DashboardLayout title="Office Location">
      {loading && !data ? (
        <Card>
          <LoadingBuffer variant="section" />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-sm text-muted-foreground">{hint}</p>
              <div className="inline-flex rounded-md border border-border p-0.5 text-sm" role="group" aria-label="What a click on the map adds">
                {([['corner', `Corners${corners.length ? ` (${corners.length})` : ''}`], ['road', `Road edge${roadPoints.length ? ` (${roadPoints.length}/2)` : ''}`], ['pin', 'Pin']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={tapMode === mode}
                    className={cn('rounded px-3 py-1.5 font-medium', tapMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                    onClick={() => setTapMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[68vh] min-h-[28rem]">
              <OfficeMap
                active={boundaries.active}
                ariaLabel="Satellite map of the office grounds"
                corners={corners}
                draft={boundaries.draft}
                onMovePoint={handleMove}
                onTap={handleTap}
                pin={pinValid}
                pinDraft={pinDraft}
                roadPoints={roadPoints}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
              {legend.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0 w-5 border-t-[3px]" style={{ borderColor: item.color, borderStyle: item.dashed ? 'dashed' : 'solid' }} />
                  {item.label}
                </span>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Sign-in area</h2>
                <span className={cn('inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold', status.className)}>{status.label}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {boundaries.active
                  ? `The office grounds: ${describeBoundary(boundaries.active)}.`
                  : pinValid ? `A circle of ${pinValid.radiusMeters} m around the office pin.` : 'Set the office pin to start.'}
              </p>
              {programToday && (
                <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  Today staff sign in at {programToday.name} (program, {programToday.radiusMeters} m{programToday.scheduleEndDate ? ` until ${programToday.scheduleEndDate}` : ''}).
                </p>
              )}
              {boundaries.draft && (
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/10 p-3">
                  <p className="text-sm"><span className="font-semibold">Proposed:</span> {describeBoundary(boundaries.draft)}.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button className="h-10 gap-2" onClick={() => boundaryAction('approve')} disabled={busy !== null}>
                      {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Use this boundary
                    </Button>
                    <Button className="h-10" variant="outline" onClick={() => boundaryAction('discard')} disabled={busy !== null}>Discard</Button>
                  </div>
                </div>
              )}
              {boundaries.active && (
                <Button className="h-9 px-0 text-muted-foreground" variant="link" onClick={() => boundaryAction('remove')} disabled={busy !== null}>
                  Back to the circle
                </Button>
              )}
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Draw a boundary</h2>
                {(boundaries.draft || boundaries.active) && (
                  <Button className="h-8 px-2" variant="ghost" size="sm" onClick={editExisting}>
                    Edit {boundaries.draft ? 'proposed' : 'current'}
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Corners: the wall and car parks. Road edge: 2 points along the road in front, so the far side stays out.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Room for phone error">
                  <MetersInput value={roomMeters} onChange={setRoomMeters} />
                </Field>
                <Field label="Past the road edge">
                  <MetersInput value={roadAllowanceMeters} onChange={setRoadAllowanceMeters} />
                </Field>
              </div>
              <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-2">
                <Button
                  className="h-10 gap-1.5"
                  variant="outline"
                  onClick={() => (tapMode === 'road' ? setRoadPoints((current) => current.slice(0, -1)) : setCorners((current) => current.slice(0, -1)))}
                  disabled={tapMode === 'road' ? roadPoints.length === 0 : corners.length === 0}
                >
                  <Undo2 className="h-4 w-4" />
                  Undo
                </Button>
                <Button className="h-10" variant="outline" onClick={clearDrawing} disabled={corners.length === 0 && roadPoints.length === 0}>Clear</Button>
                <Button className="h-10 gap-2" onClick={() => boundaryAction('propose')} disabled={busy !== null || corners.length < 3}>
                  {busy === 'propose' && <Loader2 className="h-4 w-4 animate-spin" />}
                  Propose boundary
                </Button>
              </div>
            </Card>

            <details className="group rounded-lg border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-base font-semibold">
                Pin and circle
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-border p-4">
                <p className="text-sm text-muted-foreground">
                  The circle is used when no boundary is on, and for program locations away from the office.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(['default', 'scheduled'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={pinMode === mode}
                      className={cn(
                        'h-10 rounded-md border text-sm font-semibold transition-colors',
                        pinMode === mode ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-card',
                      )}
                      onClick={() => setPinMode(mode)}
                    >
                      {mode === 'default' ? 'Office' : 'Program'}
                    </button>
                  ))}
                </div>
                {pinMode === 'scheduled' && (
                  <div className="space-y-2">
                    <Field label="Program name">
                      <Input className="h-10" value={programName} onChange={(event) => setProgramName(event.target.value)} placeholder="Program Location" maxLength={120} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Starts"><DateField value={scheduleStartDate} onChange={setScheduleStartDate} inputClassName="h-10" /></Field>
                      <Field label="Ends"><DateField value={scheduleEndDate} onChange={setScheduleEndDate} inputClassName="h-10" /></Field>
                    </div>
                  </div>
                )}
                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Pin</p>
                  <p className="mt-0.5 font-mono text-sm">
                    {pinDraft
                      ? `${pinDraft.latitude.toFixed(6)}, ${pinDraft.longitude.toFixed(6)} (new)`
                      : pinMode === 'default' && pinValid ? `${pinValid.latitude.toFixed(6)}, ${pinValid.longitude.toFixed(6)}` : 'Not picked'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-10 gap-2" variant="outline" onClick={() => setTapMode('pin')}>
                    <MapPin className="h-4 w-4" />
                    Pick on map
                  </Button>
                  <Button className="h-10 gap-2" variant="outline" onClick={useThisDevice} disabled={busy !== null}>
                    {busy === 'detect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                    This device
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Circle">
                    <MetersInput
                      value={radiusMeters}
                      onChange={(value) => {
                        limitsEditedRef.current = true;
                        setRadiusMeters(value);
                      }}
                    />
                  </Field>
                  <Field label="Reading quality">
                    <select
                      className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      value={maxAccuracyMeters}
                      onChange={(event) => {
                        limitsEditedRef.current = true;
                        setMaxAccuracyMeters(event.target.value);
                      }}
                    >
                      <option value="50">Strict (50 m)</option>
                      <option value="75">Standard (75 m)</option>
                      <option value="100">Flexible (100 m)</option>
                    </select>
                  </Field>
                </div>
                <Button className="h-10 w-full gap-2" onClick={savePin} disabled={busy !== null}>
                  {busy === 'save-pin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {pinMode === 'scheduled' ? 'Save program location' : 'Save pin and circle'}
                </Button>
              </div>
            </details>

            {notice && !error && (
              <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">{notice}</div>
            )}
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function MetersInput({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  return (
    <div className="relative">
      <Input
        className="h-10 pr-9 font-mono"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">m</span>
    </div>
  );
}
