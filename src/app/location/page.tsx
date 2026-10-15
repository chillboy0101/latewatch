'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Loader2, Pencil } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { MAP_COLORS, OfficeMap, type MapPoint } from '@/components/location/office-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import {
  boundaryCircle,
  DEFAULT_BOUNDARY_ROOM_METERS,
  DEFAULT_ROAD_ALLOWANCE_METERS,
  MAX_BOUNDARY_CORNERS,
  nearestEdgeIndex,
  parseOfficeBoundary,
  type LatLng,
  type OfficeBoundary,
} from '@/lib/office-boundary';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

// Office Location: where staff can sign in, drawn on the satellite map. The area is the office
// grounds plus spare room for phone error, stopping a little past the road in front. The office
// pin and circle are made from it, so there is nothing else to set.

type Pin = LatLng & { radiusMeters: number };
type State = { active: OfficeBoundary | null; draft: OfficeBoundary | null; pin: Pin | null };
type Action = 'approve' | 'discard' | 'remove' | 'save';
type EditMode = 'corner' | 'road';

const NOTICES: Record<Action, string> = {
  approve: 'The office area is on. Sign-ins follow it from now.',
  discard: 'Proposed area removed.',
  remove: 'Sign-in uses the circle again.',
  save: 'Saved. Sign-ins follow the new area from now.',
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const withId = (point: LatLng): MapPoint => ({ id: newId(), latitude: point.latitude, longitude: point.longitude });

// Four points round a circle, to frame the map on everything it covers.
function aroundCircle(circle: LatLng & { radiusMeters: number }): LatLng[] {
  const degrees = circle.radiusMeters / 111_195;
  const across = degrees / Math.cos((circle.latitude * Math.PI) / 180);
  return [
    { latitude: circle.latitude + degrees, longitude: circle.longitude },
    { latitude: circle.latitude - degrees, longitude: circle.longitude },
    { latitude: circle.latitude, longitude: circle.longitude + across },
    { latitude: circle.latitude, longitude: circle.longitude - across },
  ];
}

function framePoints(area: OfficeBoundary | null, pin: (LatLng & { radiusMeters: number }) | null): LatLng[] {
  if (area) return aroundCircle(boundaryCircle(area));
  return pin ? aroundCircle(pin) : [];
}

function describe(area: OfficeBoundary) {
  return `${area.outline.length} corners · ${area.roomMeters} m spare${area.road ? ` · stops ${area.road.allowanceMeters} m past the road` : ''}`;
}

export default function LocationPage() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<EditMode>('corner');
  const [corners, setCorners] = useState<MapPoint[]>([]);
  const [roadPoints, setRoadPoints] = useState<MapPoint[]>([]);
  const [roomMeters, setRoomMeters] = useState(String(DEFAULT_BOUNDARY_ROOM_METERS));
  const [roadMeters, setRoadMeters] = useState(String(DEFAULT_ROAD_ALLOWANCE_METERS));
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Where the map opens: framed once, on the first area (or pin) that loads.
  const [fitTo, setFitTo] = useState<LatLng[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/attendance/location/boundary', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not load the office location (${response.status})`);
      setState({ active: body.active ?? null, draft: body.draft ?? null, pin: body.pin ?? null });
      setFitTo((current) => (current.length > 0 ? current : framePoints(body.active || body.draft || null, body.pin || null)));
      setLoadError(null);
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Could not load the office location.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;
    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({ channel: 'attendance', events: ['invalidate'], onEvent: load });
      if (mounted) cleanup = unsubscribe;
      else unsubscribe();
    })();
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [load]);

  // What the edit would save, drawn live on the map.
  const preview = useMemo(() => (editing
    ? parseOfficeBoundary({
        outline: corners,
        road: roadPoints.length === 2 ? { allowanceMeters: Number(roadMeters), from: roadPoints[0], to: roadPoints[1] } : null,
        roomMeters: Number(roomMeters),
      })
    : null), [corners, editing, roadMeters, roadPoints, roomMeters]);

  const previewProblem = !editing
    ? null
    : corners.length < 3
      ? `Click the map to add corners (${corners.length} of at least 3).`
      : !preview ? 'The road edge must be in front of the grounds, not across them.' : null;

  function startEditing(from: OfficeBoundary | null) {
    setCorners(from ? from.outline.map(withId) : []);
    setRoadPoints(from?.road ? [withId(from.road.from), withId(from.road.to)] : []);
    setRoomMeters(String(from?.roomMeters ?? DEFAULT_BOUNDARY_ROOM_METERS));
    setRoadMeters(String(from?.road?.allowanceMeters ?? DEFAULT_ROAD_ALLOWANCE_METERS));
    setMode('corner');
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  const handleTap = useCallback((point: LatLng) => {
    if (!editing) return;
    if (mode === 'road') {
      setRoadPoints((current) => [...current, withId(point)].slice(-2));
      return;
    }
    setCorners((current) => {
      if (current.length >= MAX_BOUNDARY_CORNERS) return current;
      const at = nearestEdgeIndex(current, point) + 1;
      return [...current.slice(0, at), withId(point), ...current.slice(at)];
    });
  }, [editing, mode]);

  const handleMove = useCallback((kind: 'corner' | 'road', id: string, point: LatLng) => {
    const update = (current: MapPoint[]) => current.map((item) => (item.id === id ? { ...item, ...point } : item));
    if (kind === 'road') setRoadPoints(update);
    else setCorners(update);
  }, []);

  const handleRemove = useCallback((kind: 'corner' | 'road', id: string) => {
    const remove = (current: MapPoint[]) => current.filter((item) => item.id !== id);
    if (kind === 'road') setRoadPoints(remove);
    else setCorners(remove);
  }, []);

  async function run(action: Action) {
    const question = action === 'save' || action === 'approve'
      ? 'Use this area for every sign-in from now on?'
      : action === 'remove' ? 'Stop using the area and go back to the circle?' : null;
    if (question && !window.confirm(question)) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/attendance/location/boundary', {
        body: JSON.stringify({ action, boundary: action === 'save' ? preview : undefined }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not update the office location (${response.status})`);
      setState({ active: body.active ?? null, draft: body.draft ?? null, pin: body.pin ?? null });
      if (action === 'save') setEditing(false);
      setNotice(NOTICES[action]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update the office location.');
    } finally {
      setBusy(null);
    }
  }

  const active = state?.active || null;
  const draft = state?.draft || null;

  return (
    <DashboardLayout title="Office Location">
      {!state ? (
        loadError ? <Message tone="error">{loadError}</Message> : <LoadingBuffer variant="section" />
      ) : (
        <div className="space-y-3">
          {editing ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <div className="inline-flex rounded-md border border-border p-0.5 text-sm" role="group" aria-label="What a click adds">
                {(['corner', 'road'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={mode === item}
                    className={cn('rounded px-3 py-1.5 font-medium', mode === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                    onClick={() => setMode(item)}
                  >
                    {item === 'corner' ? `Corners (${corners.length})` : `Road edge (${roadPoints.length}/2)`}
                  </button>
                ))}
              </div>
              <MetersField label="Spare" value={roomMeters} onChange={setRoomMeters} />
              <MetersField label="Past road" value={roadMeters} onChange={setRoadMeters} />
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {previewProblem || (mode === 'road'
                  ? 'Click 2 points along the road edge in front.'
                  : 'Click to add a corner · drag to move · click a corner to remove it.')}
              </p>
              <Button variant="outline" className="h-9" onClick={() => setEditing(false)} disabled={busy !== null}>Cancel</Button>
              <Button className="h-9 gap-2" onClick={() => run('save')} disabled={busy !== null || !preview}>
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                Save area
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', active ? 'bg-success' : 'bg-warning')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{active ? 'Sign-in area: the office grounds' : 'Sign-in area: a circle around the office pin'}</p>
                <p className="text-sm text-muted-foreground">
                  {active ? describe(active) : state.pin ? `${state.pin.radiusMeters} m around the pin` : 'Not set yet'}
                </p>
              </div>
              <Button variant="outline" className="h-9 gap-2" onClick={() => startEditing(active || draft)}>
                <Pencil className="h-4 w-4" />
                {active ? 'Edit area' : 'Draw area'}
              </Button>
            </div>
          )}

          {!editing && draft && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-4 py-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#22d3ee]" aria-hidden />
              <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">Proposed area</span> <span className="text-muted-foreground">(cyan on the map): {describe(draft)}</span></p>
              <Button variant="outline" className="h-9" onClick={() => run('discard')} disabled={busy !== null}>Discard</Button>
              <Button className="h-9 gap-2" onClick={() => run('approve')} disabled={busy !== null}>
                {busy === 'approve' && <Loader2 className="h-4 w-4 animate-spin" />}
                Use it
              </Button>
            </div>
          )}

          {notice && !error && <Message tone="success">{notice}</Message>}
          {error && <Message tone="error">{error}</Message>}

          <div className={cn('min-h-[24rem]', !editing && draft ? 'h-[calc(100dvh-19.5rem)]' : 'h-[calc(100dvh-15.5rem)]')}>
            <OfficeMap
              area={active}
              circle={state.pin}
              corners={corners}
              editing={editing}
              fitTo={fitTo}
              onMovePoint={handleMove}
              onRemovePoint={handleRemove}
              onTap={handleTap}
              overlay={editing ? preview : draft}
              roadPoints={roadPoints}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {!editing && <Swatch color={MAP_COLORS.area} dashed={!active} label={active ? 'Sign-in area' : 'Circle'} />}
              {(editing || draft) && <Swatch color={MAP_COLORS.overlay} label={editing ? 'New area' : 'Proposed'} />}
              {editing && <Swatch color={MAP_COLORS.corners} label="Your corners" />}
              <Swatch color={MAP_COLORS.road} label="Road edge" />
            </div>
            {active && !editing && (
              <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => run('remove')} disabled={busy !== null}>
                Use a circle instead
              </button>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function MetersField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {label}
      <span className="relative">
        <Input
          className="h-9 w-20 pr-7 font-mono"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 3))}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">m</span>
      </span>
    </label>
  );
}

function Swatch({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-0 w-5 border-t-[3px]" style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />
      {label}
    </span>
  );
}

function Message({ children, tone }: { children: ReactNode; tone: 'error' | 'success' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm',
        tone === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 font-medium text-success',
      )}
    >
      {tone === 'error' && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      {children}
    </div>
  );
}
