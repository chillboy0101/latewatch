'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '@/lib/utils';

// Back (the edge swipe, the Android back button) closes the top sheet instead of leaving the screen,
// like a sheet in an app. While a sheet is open it has its own history entry (same URL); going back
// pops it and closes the sheet, and closing the sheet any other way takes the entry back off.
let lastSheetId = 0;
let pendingPops = 0;

function popSheetEntries() {
  // Sheets closing together (a parent with its child) take all their entries off in one step.
  pendingPops += 1;
  if (pendingPops > 1) return;
  queueMicrotask(() => {
    const count = pendingPops;
    pendingPops = 0;
    if (count > 0) window.history.go(-count);
  });
}

function sheetEntryId() {
  const state: unknown = window.history.state;
  const id = state && typeof state === 'object' ? (state as { latewatchSheet?: unknown }).latewatchSheet : undefined;
  return typeof id === 'number' ? id : null;
}

function useCloseOnBack(open: boolean | undefined, onOpenChange: ((open: boolean) => void) | undefined) {
  const closeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    closeRef.current = onOpenChange;
  });

  React.useEffect(() => {
    if (!open || !closeRef.current) return;
    const id = ++lastSheetId;
    // Keep the router's own state on the entry so it treats it as the same screen. A sheet that was
    // closed and reopened straight away (or remounted) reuses the entry still waiting to be removed.
    const state = { ...(window.history.state ?? {}), latewatchSheet: id };
    if (pendingPops > 0 && sheetEntryId() !== null) {
      pendingPops -= 1;
      window.history.replaceState(state, '');
    } else {
      window.history.pushState(state, '');
    }
    let closedByBack = false;

    const onPopState = () => {
      const top = sheetEntryId();
      if (top === null || top < id) {
        closedByBack = true;
        closeRef.current?.(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Closed from the sheet (swipe down, a button), not by back: remove its entry. If the app has
      // already moved to another screen, the entry is behind it and is left alone.
      const top = sheetEntryId();
      if (!closedByBack && top !== null && top >= id) popSheetEntries();
    };
  }, [open]);
}

function Drawer({
  shouldScaleBackground = false,
  noBodyStyles = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  useCloseOnBack(props.open, props.onOpenChange);
  // noBodyStyles: the check-in page is already `fixed inset-0`, so vaul's body
  // scroll-lock (position:fixed on <body>) is unnecessary and is what flashes
  // the Android nav bar when a sheet opens.
  return (
    <DrawerPrimitive.Root
      shouldScaleBackground={shouldScaleBackground}
      noBodyStyles={noBodyStyles}
      {...props}
    />
  );
}
Drawer.displayName = 'Drawer';

// Stacked child sheet: opens on top of a parent Drawer and scales it back;
// swiping the child down returns to the parent. Must be rendered inside a
// parent Drawer.Root subtree (vaul requirement).
function DrawerNested({
  noBodyStyles = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.NestedRoot>) {
  useCloseOnBack(props.open, props.onOpenChange);
  return <DrawerPrimitive.NestedRoot noBodyStyles={noBodyStyles} {...props} />;
}
DrawerNested.displayName = 'DrawerNested';

const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerPortal = DrawerPrimitive.Portal;
const DrawerClose = DrawerPrimitive.Close;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 data-[state=closed]:pointer-events-none', className)}
    {...props}
  />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & { hideHandle?: boolean }
>(({ className, children, hideHandle = false, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        'drawer-glass fixed inset-x-[9px] bottom-[9px] z-50 mt-24 mx-auto flex h-auto flex-col overflow-hidden rounded-[38px] border border-border/50 shadow-2xl outline-none',
        'pb-[env(safe-area-inset-bottom)]',
        'sm:max-w-md',
        className,
      )}
      {...props}
    >
      {/* A slim, quiet grabber like the system sheets on iOS and Android. The whole top of the
          sheet is draggable, so the handle only needs to be seen, not aimed at. */}
      {!hideHandle && (
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
      )}
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = 'DrawerContent';

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-1 p-4 text-left', className)} {...props} />;
}
DrawerHeader.displayName = 'DrawerHeader';

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight text-foreground', className)}
    {...props}
  />
));
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerNested,
  DrawerDescription,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
