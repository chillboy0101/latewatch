'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type WhatsAppNoticeQueueItem = {
  amount: string;
  href: string;
  message: string;
  phone: string;
  staffId: string;
  staffName: string;
  type: 'daily' | 'weekly';
};

type NoticeState = 'sent' | 'skipped';

type WhatsAppNoticeQueueProps = {
  date?: string;
  description?: string;
  error?: string | null;
  loading?: boolean;
  notices: WhatsAppNoticeQueueItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  weekEnd?: string;
  weekStart?: string;
};

function noticeKey(notice: WhatsAppNoticeQueueItem) {
  return `${notice.type}:${notice.staffId}:${notice.amount}`;
}

export function WhatsAppNoticeQueue({
  date,
  description,
  error,
  loading = false,
  notices,
  onOpenChange,
  open,
  title,
  weekEnd,
  weekStart,
}: WhatsAppNoticeQueueProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actioningKey, setActioningKey] = useState<string | null>(null);
  const [handled, setHandled] = useState<Record<string, NoticeState>>({});
  const noticeIdentity = useMemo(() => notices.map(noticeKey).join('|'), [notices]);
  const pendingCount = notices.filter((notice) => !handled[noticeKey(notice)]).length;

  useEffect(() => {
    if (!open) return;

    setActionError(null);
    setActioningKey(null);
    setHandled({});
  }, [noticeIdentity, open]);

  async function markSent(notice: WhatsAppNoticeQueueItem) {
    const key = noticeKey(notice);
    setActioningKey(key);
    setActionError(null);

    try {
      const response = await fetch('/api/whatsapp/mark-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: notice.amount,
          date,
          staffId: notice.staffId,
          staffName: notice.staffName,
          type: notice.type,
          weekEnd,
          weekStart,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not mark this notice sent');
      }

      setHandled((prev) => ({ ...prev, [key]: 'sent' }));
    } catch (err) {
      console.error('Failed to mark WhatsApp notice sent:', err);
      setActionError(err instanceof Error ? err.message : 'Could not mark this notice sent');
    } finally {
      setActioningKey(null);
    }
  }

  function skipNotice(notice: WhatsAppNoticeQueueItem) {
    setHandled((prev) => ({ ...prev, [noticeKey(notice)]: 'skipped' }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
            <span className="font-medium">{notices.length} recipient{notices.length === 1 ? '' : 's'}</span>
            <span className="text-muted-foreground">{pendingCount} pending</span>
          </div>

          {(error || actionError) && (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error || actionError}
            </p>
          )}

          <div className="min-h-[220px] overflow-y-auto pr-1">
            {loading ? (
              <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading notices
              </div>
            ) : notices.length === 0 ? (
              <div className="flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-border text-center text-sm text-muted-foreground">
                No WhatsApp-ready penalty notices for this selection.
              </div>
            ) : (
              <div className="space-y-3">
                {notices.map((notice) => {
                  const key = noticeKey(notice);
                  const state = handled[key];
                  const isActioning = actioningKey === key;

                  return (
                    <div
                      key={key}
                      className={cn(
                        'rounded-md border border-border bg-background p-3',
                        state === 'sent' && 'border-success/30 bg-success/5',
                        state === 'skipped' && 'opacity-70',
                      )}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{notice.staffName}</p>
                            <span className="rounded-full bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground">
                              GHC {notice.amount}
                            </span>
                            {state && (
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-medium',
                                state === 'sent' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                              )}>
                                {state === 'sent' ? 'Sent' : 'Skipped'}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">{notice.phone}</p>
                          <p className="mt-2 text-sm leading-6 text-foreground/80">{notice.message}</p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                          <Button asChild size="sm" className="gap-2">
                            <a href={notice.href} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open WhatsApp
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => markSent(notice)}
                            disabled={isActioning || state === 'sent'}
                          >
                            {isActioning ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5" />
                            )}
                            Mark sent
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-2"
                            onClick={() => skipNotice(notice)}
                            disabled={Boolean(state)}
                          >
                            <SkipForward className="h-3.5 w-3.5" />
                            Skip
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
