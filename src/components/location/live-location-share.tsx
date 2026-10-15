'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, Loader2, Radio, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Shares this phone's live position while walking the office grounds, so the boundary can be traced
// from the path walked. Positions go to /api/attendance/location/trace (admin-only, kept 24 hours).

type Reading = { accuracy: number; latitude: number; longitude: number; note: string | null; timestamp: number };

const POLL_MS = 2_000;
const SEND_MS = 5_000;
const MAX_BATCH = 20;
const MAX_BUFFER = 120;
const AUTO_STOP_MS = 30 * 60 * 1000;

type WakeLock = { release: () => Promise<void> };

export function LiveLocationShare() {
  const [sharing, setSharing] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [marked, setMarked] = useState('');
  const [, setTick] = useState(0);
  const bufferRef = useRef<Reading[]>([]);
  const pendingNoteRef = useRef<string | null>(null);
  const lastTimestampRef = useRef(0);
  const sendingRef = useRef(false);
  const timersRef = useRef<{ autoStop?: number; poll?: number; send?: number; tick?: number; watch?: number }>({});
  const wakeLockRef = useRef<WakeLock | null>(null);

  const send = useCallback(async () => {
    if (sendingRef.current || bufferRef.current.length === 0) return;
    sendingRef.current = true;
    const batch = bufferRef.current.splice(0, MAX_BATCH);
    try {
      const response = await fetch('/api/attendance/location/trace', {
        body: JSON.stringify({ readings: batch }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Sending failed (${response.status})`);
      }
      setSent((count) => count + batch.length);
      setLastSentAt(Date.now());
      setError('');
    } catch (sendError) {
      // Keep the readings and try again on the next round (a short signal drop loses nothing).
      bufferRef.current = [...batch, ...bufferRef.current].slice(-MAX_BUFFER);
      setError(sendError instanceof Error ? sendError.message : 'Sending failed');
    } finally {
      sendingRef.current = false;
    }
  }, []);

  const keepScreenOn = useCallback(async () => {
    try {
      const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } }).wakeLock;
      if (wakeLock && !wakeLockRef.current) wakeLockRef.current = await wakeLock.request('screen');
    } catch {
      // Not supported or refused: sharing still works while the screen stays on.
    }
  }, []);

  const stop = useCallback(() => {
    const timers = timersRef.current;
    if (timers.watch !== undefined) navigator.geolocation.clearWatch(timers.watch);
    for (const id of [timers.poll, timers.send, timers.tick]) if (id !== undefined) window.clearInterval(id);
    if (timers.autoStop !== undefined) window.clearTimeout(timers.autoStop);
    timersRef.current = {};
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
    setSharing(false);
    // Send what is left now, and once more shortly in case a send was still on its way.
    void send();
    window.setTimeout(() => void send(), 1_500);
  }, [send]);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setError('This browser does not support location.');
      return;
    }
    setError('');
    setSent(0);
    setLastSentAt(null);
    setAccuracy(null);
    bufferRef.current = [];
    lastTimestampRef.current = 0;

    const onReading = (position: GeolocationPosition) => {
      if (position.timestamp === lastTimestampRef.current) return;
      lastTimestampRef.current = position.timestamp;
      bufferRef.current.push({
        accuracy: position.coords.accuracy,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        note: pendingNoteRef.current,
        timestamp: position.timestamp,
      });
      pendingNoteRef.current = null;
      if (bufferRef.current.length > MAX_BUFFER) bufferRef.current = bufferRef.current.slice(-MAX_BUFFER);
      setAccuracy(position.coords.accuracy);
    };
    const onFailure = (geoError: GeolocationPositionError) => {
      if (geoError.code === 1) {
        setError('Location access is blocked for this browser. Allow it, then start again.');
        stop();
      }
    };
    const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };

    timersRef.current = {
      autoStop: window.setTimeout(() => stop(), AUTO_STOP_MS),
      poll: window.setInterval(() => navigator.geolocation.getCurrentPosition(onReading, () => undefined, options), POLL_MS),
      send: window.setInterval(() => void send(), SEND_MS),
      tick: window.setInterval(() => setTick((value) => value + 1), 1_000),
      watch: navigator.geolocation.watchPosition(onReading, onFailure, options),
    };
    setSharing(true);
    void keepScreenOn();
  }, [keepScreenOn, send, stop]);

  // The screen lock is dropped when the page is hidden; take it again on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && sharing) {
        wakeLockRef.current = null;
        void keepScreenOn();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [keepScreenOn, sharing]);

  // Leaving the page ends sharing: send what is left and let the screen sleep again.
  useEffect(() => () => {
    const timers = timersRef.current;
    if (timers.watch !== undefined) navigator.geolocation.clearWatch(timers.watch);
    for (const id of [timers.poll, timers.send, timers.tick]) if (id !== undefined) window.clearInterval(id);
    if (timers.autoStop !== undefined) window.clearTimeout(timers.autoStop);
    void wakeLockRef.current?.release().catch(() => undefined);
    void send();
  }, [send]);

  function markSpot() {
    const label = note.trim().slice(0, 60) || 'Marked spot';
    pendingNoteRef.current = label;
    setMarked(label);
    setNote('');
  }

  const sentAgo = lastSentAt ? Math.max(0, Math.round((Date.now() - lastSentAt) / 1000)) : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Radio className={sharing ? 'h-5 w-5 animate-pulse text-success' : 'h-5 w-5 text-primary'} />
          Share live location
        </h2>
        {sharing ? (
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={stop}>
            <Square className="h-4 w-4" />
            Stop
          </Button>
        ) : (
          <Button size="sm" className="h-9 gap-2" onClick={start}>
            <Radio className="h-4 w-4" />
            Start
          </Button>
        )}
      </div>

      <div className="space-y-3 p-4">
        {sharing ? (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sharing live{accuracy !== null ? ` · ±${Math.round(accuracy)} m` : ''}
              {sentAgo !== null ? ` · sent ${sentAgo} s ago` : ' · waiting for the first reading'}
              {sent > 0 ? ` · ${sent} reading${sent === 1 ? '' : 's'}` : ''}
            </p>
            <div className="flex gap-2">
              <Input
                aria-label="What is this spot?"
                className="h-10"
                maxLength={60}
                placeholder="e.g. gate, back corner"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button variant="outline" className="h-10 shrink-0 gap-2" onClick={markSpot}>
                <Flag className="h-4 w-4" />
                Mark this spot
              </Button>
            </div>
            {marked && <p className="text-xs text-muted-foreground">Last marked: {marked}</p>}
            <p className="text-xs text-muted-foreground">
              Keep LateWatch open while walking. Switching apps pauses sharing. Stops by itself after 30 minutes.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sends this phone&apos;s location every few seconds while you walk the grounds, so the boundary can be traced from your path. Kept for 24 hours.
          </p>
        )}
        {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      </div>
    </Card>
  );
}
