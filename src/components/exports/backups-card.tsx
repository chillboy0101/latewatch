'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, DatabaseBackup, Download, History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatDisplayDateTime } from '@/lib/date-format';
import { cn } from '@/lib/utils';

type Backup = {
  createdAt: string;
  createdBy: string;
  id: string;
  sizeBytes: number;
  source: 'manual' | 'weekly' | 'before-restore';
  totalRows: number;
};

// Two decimals in MB so a week's growth is visible (3.27 MB → 3.29 MB), not hidden by rounding.
export function formatBackupSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const SOURCE_LABELS: Record<Backup['source'], string> = {
  'before-restore': 'safety copy before a restore',
  manual: 'manual',
  weekly: 'automatic',
};

// A Sunday backup is due every 7 days; one more day of grace before warning.
export const STALE_BACKUP_DAYS = 8;

export function isBackupStale(newestCreatedAt: string | undefined, now = Date.now()) {
  if (!newestCreatedAt) return false;
  return now - Date.parse(newestCreatedAt) > STALE_BACKUP_DAYS * 86_400_000;
}

function rowChange(backups: Backup[], index: number) {
  const older = backups[index + 1];
  if (!older) return null;
  const change = backups[index].totalRows - older.totalRows;
  return `${change >= 0 ? '+' : '−'}${Math.abs(change).toLocaleString()} since previous`;
}

// Data backups kept in Cloudflare R2 (Sundays, "Back Up Now", and before each restore). Last 12
// weeks kept. Admins can download one or put its data back.
export function BackupsCard() {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [confirmText, setConfirmText] = useState('');

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

  async function download(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/backups?download=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error || 'Could not get the download link.');
      window.location.href = body.url;
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Could not get the download link.' });
    } finally {
      setBusy(null);
    }
  }

  function openRestore(backup: Backup) {
    setConfirmText('');
    setRestoreTarget(backup);
  }

  async function restore() {
    if (!restoreTarget || confirmText !== 'RESTORE') return;
    setBusy('restore');
    setMessage(null);
    try {
      const response = await fetch('/api/admin/backups/restore', {
        body: JSON.stringify({ confirm: confirmText, id: restoreTarget.id }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Restore failed. Nothing was changed.');
      const records = Object.values(body.restored as Record<string, number>).reduce((sum, count) => sum + count, 0);
      const kept = Array.isArray(body.keptAsIs) && body.keptAsIs.length > 0
        ? ' This older backup has no staff type history or deactivation periods, so those were kept as they are.'
        : '';
      setMessage({
        error: false,
        text: `Restored ${records.toLocaleString()} records from ${formatDisplayDateTime(restoreTarget.createdAt)}. A safety copy of the data from before the restore is at the top of the list.${kept}`,
      });
      setRestoreTarget(null);
      await load();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Restore failed. Nothing was changed.' });
      setRestoreTarget(null);
    } finally {
      setBusy(null);
    }
  }

  const stale = backups !== null && isBackupStale(backups[0]?.createdAt);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
              <DatabaseBackup className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-none">Backups</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Every Sunday · last 12 weeks kept</p>
            </div>
          </div>
          <Button className="h-10 gap-2 sm:w-auto" onClick={() => void backUpNow()} disabled={busy !== null} aria-busy={busy === 'now'}>
            {busy === 'now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
            {busy === 'now' ? 'Backing Up' : 'Back Up Now'}
          </Button>
        </div>
      </div>

      <div className="px-6 py-4">
        {stale && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            No backup in the last {STALE_BACKUP_DAYS} days. The Sunday backup may have failed; use Back Up Now.
          </p>
        )}
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
            {backups.map((backup, index) => {
              const change = rowChange(backups, index);
              return (
              <li key={backup.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{formatDisplayDateTime(backup.createdAt)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {backup.totalRows.toLocaleString()} records
                    {change && ` (${change})`}
                    {' · '}{formatBackupSize(backup.sizeBytes)} · {SOURCE_LABELS[backup.source]}
                    {backup.source !== 'weekly' && ` · ${backup.createdBy}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy !== null}
                    onClick={() => void download(backup.id)}
                  >
                    {busy === backup.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Download
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => openRestore(backup)}>
                    <History className="h-3.5 w-3.5" />
                    Restore
                  </Button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open && busy !== 'restore') setRestoreTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription>
              {restoreTarget && `All staff, attendance, charges, payments, leave and permissions go back to ${formatDisplayDateTime(restoreTarget.createdAt)}. Anything entered after that is removed.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              A safety copy of today&apos;s data is taken first, so you can restore that one to undo. If anything goes wrong, nothing is changed.
            </p>
            <label className="block space-y-1.5">
              <span className="font-medium">Type RESTORE to confirm</span>
              <Input
                autoComplete="off"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value.toUpperCase())}
                disabled={busy === 'restore'}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={busy === 'restore'}>Cancel</Button>
            <Button onClick={() => void restore()} disabled={confirmText !== 'RESTORE' || busy === 'restore'} aria-busy={busy === 'restore'}>
              {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
              {busy === 'restore' ? 'Restoring' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
