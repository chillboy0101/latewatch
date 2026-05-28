'use client';

import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type WorkbookPreviewSession = {
  expiresAt: string;
  fileName: string;
  sessionId: string;
  viewerUrl: string;
};

export function WorkbookPreviewDialog({
  onOpenChange,
  open,
  session,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  session: WorkbookPreviewSession | null;
}) {
  const expiresAt = session ? new Date(session.expiresAt) : null;
  const expiryLabel = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(94vh,64rem)] w-[min(98vw,96rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b border-border bg-card px-4 py-3 pr-12 sm:px-5">
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-base md:text-lg">
                  {session?.fileName || 'Workbook preview'}
                </DialogTitle>
                <DialogDescription className="mt-1 truncate">
                  Read-only Excel preview inside LateWatch{expiryLabel ? `, available until ${expiryLabel}` : ''}.
                </DialogDescription>
              </div>
            </div>

            {session && (
              <Button asChild variant="outline" size="sm" className="h-9 shrink-0 gap-2 px-3 text-xs font-semibold">
                <a href={session.viewerUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open in new tab
                </a>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-hidden bg-background">
          {session ? (
            <iframe
              className="h-full w-full border-0 bg-background"
              src={session.viewerUrl}
              title={`Preview ${session.fileName}`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Preparing preview
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
