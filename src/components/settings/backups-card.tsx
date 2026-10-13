'use client';

import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDisplayDateTime } from '@/lib/date-format';
import { cn } from '@/lib/utils';

type Backup = {
  createdAt: string;
  createdBy: string;
  date: string;
  sizeBytes: number;
  totalRows: number;
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Weekly data backups kept in Cloudflare R2 (Sundays, plus any made here). Last 12 weeks kept.
export function BackupsCard() {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/backups', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load backups.');
      setBackups(Array.isArray(body.backups) ? body.backups : []);
    } catch (error) {
      setBackups([]);
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Could not load backups.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function backUpNow() {
    setBusy('now');
    setMessage(null);
    try {
      const response = await fetch('/api/admin/backups', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Backup failed.');
      setMessage({ error: false, text: `Backed up ${body.backup.totalRows.toLocaleString()} records.` });
      await load();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Backup failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function download(date: string) {
    setBusy(date);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/backups?download=${encodeURIComponent(date)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error || 'Could not get the download link.');
      window.location.href = body.url;
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Could not get the download link.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Backups</h2>
            <p className="text-sm text-muted-foreground">Every Sunday · last 12 weeks kept</p>
          </div>
          <Button onClick={() => void backUpNow()} disabled={busy !== null} className="gap-2">
            {busy === 'now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
            Back up now
          </Button>
        </div>

        {message && (
          <p className={cn('mb-3 text-sm font-medium', message.error ? 'text-danger' : 'text-primary')}>{message.text}</p>
        )}

        {backups === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading backups
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No backups yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {backups.map((backup) => (
              <li key={backup.date} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{formatDisplayDateTime(backup.createdAt)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {backup.totalRows.toLocaleString()} records · {formatSize(backup.sizeBytes)}
                    {backup.createdBy.startsWith('cron:') ? ' · automatic' : ` · ${backup.createdBy}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void download(backup.date)}
                >
                  {busy === backup.date ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
