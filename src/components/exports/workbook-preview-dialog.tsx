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
      <DialogContent className="flex h-[min(90vh,56rem)] w-[min(96vw,82rem)] max-w-none grid-rows-[auto_1fr] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-base md:text-lg">
                  {session?.fileName || 'Workbook preview'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Read-only Excel preview inside LateWatch{expiryLabel ? `, available until ${expiryLabel}` : ''}.
                </DialogDescription>
              </div>
            </div>

            {session && (
              <Button asChild variant="outline" size="sm" className="shrink-0 gap-2">
                <a href={session.viewerUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open Viewer
                </a>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 bg-background">
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
