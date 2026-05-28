'use client';

import { useState } from 'react';
import { ExternalLink, FileSpreadsheet, ShieldCheck } from 'lucide-react';
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
  fallbackViewerUrl: string;
  fileName: string;
  sessionId: string;
  viewerUrl: string;
};

type PreviewMode = 'interactive' | 'safe';

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
        {session ? (
          <WorkbookPreviewFrame
            key={session.sessionId}
            expiryLabel={expiryLabel}
            session={session}
          />
        ) : (
          <>
            <DialogHeader className="space-y-0 border-b border-border bg-card px-4 py-3 pr-12 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base md:text-lg">
                    Workbook preview
                  </DialogTitle>
                  <DialogDescription className="mt-1 truncate">
                    Preparing preview
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid min-h-0 place-items-center bg-background text-sm text-muted-foreground">
              Preparing preview
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkbookPreviewFrame({
  expiryLabel,
  session,
}: {
  expiryLabel: string | null;
  session: WorkbookPreviewSession;
}) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('interactive');
  const activeViewerUrl = previewMode === 'safe'
    ? session.fallbackViewerUrl
    : session.viewerUrl;

  function toggleSafeView() {
    if (previewMode === 'safe') {
      setPreviewMode('interactive');
      return;
    }
    setPreviewMode('safe');
  }

  return (
    <>
      <DialogHeader className="space-y-0 border-b border-border bg-card px-4 py-3 pr-12 sm:px-5">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base md:text-lg">
                {session.fileName}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate">
                Read-only Excel preview inside LateWatch{expiryLabel ? `, available until ${expiryLabel}` : ''}.
              </DialogDescription>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={previewMode === 'safe' ? 'default' : 'outline'}
              size="sm"
              className="h-9 gap-2 px-3 text-xs font-semibold"
              onClick={toggleSafeView}
            >
              <ShieldCheck className="h-4 w-4" />
              {previewMode === 'safe' ? 'Standard view' : 'Safe view'}
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 gap-2 px-3 text-xs font-semibold">
              <a href={activeViewerUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open in new tab
              </a>
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 overflow-hidden bg-background">
        <iframe
          key={activeViewerUrl}
          className="h-full w-full border-0 bg-background"
          src={activeViewerUrl}
          title={`Preview ${session.fileName}`}
          referrerPolicy="no-referrer"
        />
      </div>
    </>
  );
}
