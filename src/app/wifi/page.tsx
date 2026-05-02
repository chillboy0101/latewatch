'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Wifi, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingBuffer } from '@/components/ui/loading-buffer';
import { subscribeRealtimeChannel } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

interface OfficeNetworkResponse {
  configured: boolean;
  currentIp: string;
  currentIpSource: string | null;
  isOfficeNetwork: boolean;
  network: {
    allowedIp: string;
    id: string;
    name: string;
    updatedAt: string | null;
    updatedByEmail: string | null;
  } | null;
}

function formatNetworkIp(value: string) {
  if (value === '::1') return 'Localhost (::1)';
  if (value === '127.0.0.1') return 'Localhost (127.0.0.1)';
  if (value === 'local') return 'Localhost';
  return value;
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString();
}

export default function WifiPage() {
  const [networkData, setNetworkData] = useState<OfficeNetworkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNetwork = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/attendance/network', { cache: 'no-store' });
      if (!response.ok) throw new Error(`WiFi request failed (${response.status})`);
      setNetworkData(await response.json());
    } catch (err) {
      console.error('Failed to load office WiFi:', err);
      setError(err instanceof Error ? err.message : 'Could not load office WiFi');
      setNetworkData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNetwork();
  }, [fetchNetwork]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const unsubscribe = await subscribeRealtimeChannel({
        channel: 'dashboard',
        events: ['invalidate'],
        onEvent: fetchNetwork,
      });

      if (mounted) {
        cleanup = unsubscribe;
      } else {
        unsubscribe();
      }
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [fetchNetwork]);

  async function setCurrentNetwork() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/attendance/network', {
        body: JSON.stringify({ name: 'Office WiFi' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Network update failed (${response.status})`);
      await fetchNetwork();
    } catch (err) {
      console.error('Failed to update office WiFi:', err);
      setError(err instanceof Error ? err.message : 'Could not update office WiFi');
    } finally {
      setSaving(false);
    }
  }

  const isVerified = Boolean(networkData?.isOfficeNetwork);
  const savedIp = networkData?.network?.allowedIp || 'Not saved';
  const currentIp = networkData?.currentIp || '-';

  return (
    <DashboardLayout title="Office WiFi">
      <div className="space-y-5">
        <Card>
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)_auto] xl:items-end">
            <div className="flex min-w-0 items-center gap-3 xl:self-center">
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border',
                isVerified
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-warning/25 bg-warning/10 text-warning',
              )}>
                <Wifi className="h-5 w-5" />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-semibold leading-none">Office WiFi</h2>
                {isVerified ? <VerifiedBadge /> : <UnknownBadge />}
              </div>
            </div>

            <div className="grid min-w-0 gap-3 md:grid-cols-3">
              <NetworkMetaChip label="Saved IP" value={formatNetworkIp(savedIp)} />
              <NetworkMetaChip label="Current IP" value={formatNetworkIp(currentIp)} />
              <NetworkMetaChip label="Last Updated" value={formatUpdatedAt(networkData?.network?.updatedAt)} />
            </div>

            <Button className="h-10 gap-2 xl:self-end" onClick={setCurrentNetwork} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Set This Network
            </Button>
          </div>
        </Card>

        {loading && (
          <Card>
            <LoadingBuffer variant="section" label="Loading WiFi" description="Checking office network." />
          </Card>
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

function VerifiedBadge() {
  return (
    <svg
      aria-label="Verified office network"
      className="h-5 w-5 shrink-0"
      role="img"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 1.6 14.1 3.4 16.8 2.9 18.1 5.3 20.8 6.1 20.9 8.9 23 10.7 21.8 13.2 22.6 15.9 20.1 17.2 19.3 19.9 16.5 20 14.7 22.1 12 21 9.3 22.1 7.5 20 4.7 19.9 3.9 17.2 1.4 15.9 2.2 13.2 1 10.7 3.1 8.9 3.2 6.1 5.9 5.3 7.2 2.9 9.9 3.4 12 1.6Z"
        fill="#1d9bf0"
      />
      <path
        d="m10.35 14.55 5.55-6.05 1.55 1.42-6.95 7.58-4.05-4.05 1.48-1.48 2.42 2.58Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function UnknownBadge() {
  return (
    <span
      aria-label="Unknown office network"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-white"
      role="img"
    >
      <X className="h-3 w-3" />
    </span>
  );
}

function NetworkMetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0" title={`${label}: ${value}`}>
      <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">{label}</label>
      <div className="flex min-h-10 items-center rounded-md border border-border bg-background px-3 py-2">
        <span className="break-all font-mono text-xs font-semibold leading-5 text-foreground">{value}</span>
      </div>
    </div>
  );
}
