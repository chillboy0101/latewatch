'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Loader2, Pencil, Undo2, X } from 'lucide-react';
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
  outlineCrossesItself,
  parseOfficeBoundary,
  type LatLng,
  type OfficeBoundary,
} from '@/lib/office-boundary';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

// Office Location: where staff can sign in, on a full-page map. The area is the office grounds
// plus spare room for phone error, stopping a little past the road in front. The office pin and
// circle are made from it (pin in the middle, circle covering every edge), so there is nothing
// else to set. Search, map types, my location and full screen work like any map.

type Pin = LatLng & { radiusMeters: number };
type State = { active: OfficeBoundary | null; draft: OfficeBoundary | null; pin: Pin | null };
type Action = 'approve' | 'discard' | 'remove' | 'save';
type EditMode = 'corner' | 'road';
type Drawing = { corners: MapPoint[]; roadPoints: MapPoint[] };
type DrawingState = { past: Drawing[]; present: Drawing };
type DrawingAction =
  | { type: 'change'; update: (drawing: Drawing) => Drawing }
  | { type: 'reset'; drawing: Drawing }
  | { type: 'undo' };

const NOTICES: Record<Action, string> = {
  approve: 'The office area is on. Sign-ins follow it from now.',
  discard: 'Proposed area removed.',
  remove: 'Sign-in uses the circle again.',
  save: 'Saved. Sign-ins follow the new area from now.',
};
const EMPTY_DRAWING: Drawing = { corners: [], roadPoints: [] };
const MAX_UNDO = 50;
// Until an office is set, the map opens on Accra.
const FIRST_VIEW: Pin = { latitude: 5.6037, longitude: -0.187, radiusMeters: 2000 };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const withId = (point: LatLng): MapPoint => ({ id: newId(), latitude: point.latitude, longitude: point.longitude });

function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  if (action.type === 'reset') return { past: [], present: action.drawing };
  if (action.type === 'undo') {
    return state.past.length > 0 ? { past: state.past.slice(0, -1), present: state.past[state.past.length - 1] } : state;
  }
  const next = action.update(state.present);
  return next === state.present ? state : { past: [...state.past.slice(-(MAX_UNDO - 1)), state.present], present: next };
}

// Four points round a circle, to frame the map on everything it covers.
function aroundCircle(circle: Pin): LatLng[] {
  const degrees = circle.radiusMeters / 111_195;
  const across = degrees / Math.cos((circle.latitude * Math.PI) / 180);
  return [
    { latitude: circle.latitude + degrees, longitude: circle.longitude },
    { latitude: circle.latitude - degrees, longitude: circle.longitude },
    { latitude: circle.latitude, longitude: circle.longitude + across },
    { latitude: circle.latitude, longitude: circle.longitude - across },
  ];
}

function describe(area: OfficeBoundary) {
  return `${area.outline.length} corners · ${area.roomMeters} m spare${area.road ? ` · stops ${area.road.allowanceMeters} m past the road` : ''}`;
}

// A fingerprint of an edit, to tell whether anything changed since editing started.
function snapshotOf(drawing: Drawing, room: string, road: string) {
  const points = (list: MapPoint[]) => list.map(({ latitude, longitude }) => [latitude, longitude]);
  return JSON.stringify([points(drawing.corners), points(drawing.roadPoints), room, road]);
}

function metersValue(value: string) {
  if (!/^\d{1,3}$/.test(value)) return null;
  const meters = Number(value);
  return meters <= 100 ? meters : null;
}

export default function LocationPage() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<EditMode>('corner');
  const [{ past, present: drawing }, dispatch] = useReducer(drawingReducer, { past: [], present: EMPTY_DRAWING });
  const [roomMeters, setRoomMeters] = useState(String(DEFAULT_BOUNDARY_ROOM_METERS));
  const [roadMeters, setRoadMeters] = useState(String(DEFAULT_ROAD_ALLOWANCE_METERS));
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Where the map opens (and "Show the office" returns): framed on the first area or pin to load.
  const [fitTo, setFitTo] = useState<LatLng[]>([]);
  // What editing started from, to tell whether anything changed.
  const startedFromRef = useRef('');
  const { corners, roadPoints } = drawing;

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/attendance/location/boundary', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not load the office location (${response.status})`);
      const next: State = { active: body.active ?? null, draft: body.draft ?? null, pin: body.pin ?? null };
      setState(next);
      setFitTo((current) => {
        if (current.length > 0) return current;
        const area = next.active || next.draft;
        return aroundCircle(area ? boundaryCircle(area) : next.pin || FIRST_VIEW);
      });
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

  const room = metersValue(roomMeters);
  const pastRoad = metersValue(roadMeters);

  // What the edit would save, drawn live on the map.
  const preview = useMemo(() => {
    if (!editing || room === null || roadPoints.length === 1 || (roadPoints.length === 2 && pastRoad === null)) return null;
    return parseOfficeBoundary({
      outline: corners,
      road: roadPoints.length === 2 ? { allowanceMeters: pastRoad, from: roadPoints[0], to: roadPoints[1] } : null,
      roomMeters: room,
    });
  }, [corners, editing, pastRoad, roadPoints, room]);

  const problem = !editing ? null
    : corners.length < 3 ? `Click the map to add corners (${corners.length} of at least 3).`
      : outlineCrossesItself(corners) ? 'Two sides cross. Drag the corners so the outline goes round the grounds in order.'
        : roadPoints.length === 1 ? 'Add a second road edge point, or click the one you placed to remove it.'
          : room === null ? 'Spare room must be 0 to 100 m.'
            : roadPoints.length === 2 && pastRoad === null ? 'Past the road must be 0 to 100 m.'
              : !preview ? 'The road edge must be in front of the grounds, not across them.'
                : null;

  const dirty = editing && snapshotOf(drawing, roomMeters, roadMeters) !== startedFromRef.current;

  // Unsaved edits: ask before the page is closed or reloaded.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function startEditing(from: OfficeBoundary | null) {
    const start: Drawing = {
      corners: from ? from.outline.map(withId) : [],
      roadPoints: from?.road ? [withId(from.road.from), withId(from.road.to)] : [],
    };
    const startRoom = String(from?.roomMeters ?? DEFAULT_BOUNDARY_ROOM_METERS);
    const startRoad = String(from?.road?.allowanceMeters ?? DEFAULT_ROAD_ALLOWANCE_METERS);
    dispatch({ drawing: start, type: 'reset' });
    setRoomMeters(startRoom);
    setRoadMeters(startRoad);
    startedFromRef.current = snapshotOf(start, startRoom, startRoad);
    setMode('corner');
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  const stopEditing = useCallback(() => {
    if (dirty && !window.confirm('Discard your changes to the area?')) return;
    setEditing(false);
    setError(null);
  }, [dirty]);

  // Keyboard: Ctrl/Cmd+Z undoes, Escape leaves editing.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if (event.key === 'Escape' && !typing) {
        stopEditing();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, stopEditing]);

  const handleTap = useCallback((point: LatLng) => {
    if (!editing) return;
    const added = withId(point);
    if (mode === 'road') {
      dispatch({ type: 'change', update: (current) => ({ ...current, roadPoints: [...current.roadPoints, added].slice(-2) }) });
      return;
    }
    dispatch({
      type: 'change',
      update: (current) => {
        if (current.corners.length >= MAX_BOUNDARY_CORNERS) return current;
        const at = nearestEdgeIndex(current.corners, point) + 1;
        return { ...current, corners: [...current.corners.slice(0, at), added, ...current.corners.slice(at)] };
      },
    });
  }, [editing, mode]);

  const handleMove = useCallback((kind: 'corner' | 'road', id: string, point: LatLng) => {
    const move = (list: MapPoint[]) => list.map((item) => (item.id === id ? { ...item, ...point } : item));
    dispatch({ type: 'change', update: (current) => (kind === 'road' ? { ...current, roadPoints: move(current.roadPoints) } : { ...current, corners: move(current.corners) }) });
  }, []);

  const handleRemove = useCallback((kind: 'corner' | 'road', id: string) => {
    const remove = (list: MapPoint[]) => list.filter((item) => item.id !== id);
    dispatch({ type: 'change', update: (current) => (kind === 'road' ? { ...current, roadPoints: remove(current.roadPoints) } : { ...current, corners: remove(current.corners) }) });
  }, []);

  const showMessage = useCallback((message: string) => {
    setNotice(null);
    setError(message);
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
  const draftCircle = useMemo(() => (draft ? boundaryCircle(draft) : null), [draft]);
  const overlay = editing ? preview : draft;
  const showsRoad = editing ? roadPoints.length > 0 : Boolean(active?.road || draft?.road);

  return (
    <DashboardLayout title="Office Location">
      {!state ? (
        loadError ? <Message tone="error">{loadError}</Message> : <LoadingBuffer variant="section" />
      ) : (
        // The map fills the page (the layout's padding is taken back).
        <div className="-m-6 h-[calc(100dvh-4rem)]">
          <OfficeMap
            area={active}
            corners={corners}
            editing={editing}
            fitTo={fitTo}
            onMessage={showMessage}
            onMovePoint={handleMove}
            onRemovePoint={handleRemove}
            onTap={handleTap}
            overlay={overlay}
            pin={state.pin}
            roadPoints={roadPoints}
          >
            <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex max-h-[calc(100%-4rem)] w-[min(27rem,calc(100%-5rem))] flex-col gap-2 overflow-y-auto">

              {editing ? (
                <Panel>
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => dispatch({ type: 'undo' })} disabled={past.length === 0 || busy !== null}>
                      <Undo2 className="h-4 w-4" />
                      Undo
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <MetersField label="Spare" value={roomMeters} onChange={setRoomMeters} />
                    <MetersField label="Past road" value={roadMeters} onChange={setRoadMeters} />
                  </div>
                  <p className={cn('text-sm', problem && corners.length >= 3 ? 'text-warning' : 'text-muted-foreground')}>
                    {problem || (mode === 'road'
                      ? 'Click 2 points along the road edge in front.'
                      : 'Click to add a corner · drag to move · click a corner to remove it.')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-9" onClick={stopEditing} disabled={busy !== null}>Cancel</Button>
                    <Button className="h-9 gap-2" onClick={() => run('save')} disabled={busy !== null || !preview}>
                      {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save area
                    </Button>
                  </div>
                </Panel>
              ) : (
                <Panel>
                  <div className="flex items-start gap-3">
                    <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', active ? 'bg-success' : 'bg-warning')} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {active ? 'Sign-in area: the office grounds' : state.pin ? 'Sign-in area: a circle around the office pin' : 'No office location yet'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {active
                          ? `${describe(active)}. Sign-in is checked against this area only.`
                          : state.pin ? `${state.pin.radiusMeters} m around the pin` : 'Draw the office area on the map to set it.'}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => startEditing(active || draft)}>
                      <Pencil className="h-3.5 w-3.5" />
                      {active ? 'Edit area' : 'Draw area'}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {active && <Swatch color={MAP_COLORS.area} label="Sign-in area" />}
                      {state.pin && <Swatch color={MAP_COLORS.area} dashed label={active ? `Backup circle ${state.pin.radiusMeters} m (not used while the area is on)` : 'Circle'} />}
                      {draft && <Swatch color={MAP_COLORS.overlay} label="Proposed" />}
                      {showsRoad && <Swatch color={MAP_COLORS.road} label="Road edge" />}
                    </div>
                    {active && (
                      <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => run('remove')} disabled={busy !== null}>
                        Use a circle instead
                      </button>
                    )}
                  </div>
                </Panel>
              )}

              {!editing && draft && (
                <Panel className="border-[#22d3ee]/50">
                  <p className="text-sm">
                    <span className="font-semibold">Proposed area</span>{' '}
                    <span className="text-muted-foreground">
                      (cyan): {describe(draft)}{draftCircle ? `. The pin moves to its centre, with a ${draftCircle.radiusMeters} m backup circle round every edge.` : ''}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-9" onClick={() => run('discard')} disabled={busy !== null}>Discard</Button>
                    <Button className="h-9 gap-2" onClick={() => run('approve')} disabled={busy !== null}>
                      {busy === 'approve' && <Loader2 className="h-4 w-4 animate-spin" />}
                      Use it
                    </Button>
                  </div>
                </Panel>
              )}

              {notice && !error && <Message tone="success" onClose={() => setNotice(null)}>{notice}</Message>}
              {error && <Message tone="error" onClose={() => setError(null)}>{error}</Message>}
            </div>
          </OfficeMap>
        </div>
      )}
    </DashboardLayout>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('pointer-events-auto space-y-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur', className)}>
      {children}
    </div>
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

function Message({ children, onClose, tone }: { children: ReactNode; onClose?: () => void; tone: 'error' | 'success' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur',
        tone === 'error' ? 'border-danger/30 bg-card/95 text-danger' : 'border-success/30 bg-card/95 font-medium text-success',
      )}
    >
      {tone === 'error' && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{children}</span>
      {onClose && (
        <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
