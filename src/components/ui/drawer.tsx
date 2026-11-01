'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { isDeadEndEntry, leaveDeadEnd, stateWithoutDeadEnd } from '@/lib/app-nav';
import { cn } from '@/lib/utils';

// Back (the edge swipe, the Android back button) closes the top sheet instead of leaving the screen,
// like a sheet in an app. While a sheet is open it has its own history entry (same URL); going back
// pops it and closes the sheet, and closing the sheet any other way takes the entry back off.
// When a sheet last opened. On iPhones the tap that opens a sheet can arrive a second time a moment
// later; it lands behind the new sheet while it is still sliding up, counts as a tap outside, and
// closes it (and the sheet under it). Taps outside that soon after a sheet opens are ignored.
let lastSheetOpenedAt = 0;
const OPEN_GRACE_MS = 600;

let lastSheetId = 0;
let pendingPops = 0;
// Steps back still on their way (history.go lands a moment later), and sheets that opened meanwhile:
// their entries go in once the step back has landed, so it can't take the new entry off instead.
let popsInFlight = 0;
const openingAfterPops: Array<() => void> = [];
// If a step back never reports landing, stop waiting for it after this long.
const POP_SETTLE_MS = 1000;

function popSheetEntries() {
  // Sheets closing together (a parent with its child) take all their entries off in one step.
  pendingPops += 1;
  if (pendingPops > 1) return;
  queueMicrotask(() => {
    const count = pendingPops;
    pendingPops = 0;
    if (count === 0) return;
    popsInFlight += 1;
    let landed = false;
    const onLanded = () => {
      if (landed) return;
      landed = true;
      window.removeEventListener('popstate', onLanded);
      window.clearTimeout(fallback);
      popsInFlight -= 1;
      const opening = popsInFlight === 0 ? openingAfterPops.splice(0) : [];
      if (opening.length > 0) {
        // A sheet opened while this step back was on its way: its new entry also drops the
        // closed sheets' entries ahead, so no dead end is needed.
        opening.forEach((addEntry) => addEntry());
      } else {
        // The closed sheets' entries stay ahead, where a swipe forward would land: cap them off.
        window.setTimeout(leaveDeadEnd, 0);
      }
    };
    const fallback = window.setTimeout(onLanded, POP_SETTLE_MS);
    window.addEventListener('popstate', onLanded);
    window.history.go(-count);
  });
}

function sheetEntryId() {
  const state: unknown = window.history.state;
  const id = state && typeof state === 'object' ? (state as { latewatchSheet?: unknown }).latewatchSheet : undefined;
  return typeof id === 'number' ? id : null;
}

function useCloseOnBack(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
  nested = false,
) {
  const closeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    closeRef.current = onOpenChange;
  });

  React.useEffect(() => {
    if (!open) return;
    lastSheetOpenedAt = performance.now();
    if (!closeRef.current) return;
    let id = 0;
    let added = false;
    let cancelled = false;
    let closedByBack = false;

    const onPopState = () => {
      // Already closing from an earlier back: the dead end's own step back must not close it again.
      if (closedByBack) return;
      const top = sheetEntryId();
      if (top === null || top < id) {
        closedByBack = true;
        closeRef.current?.(false);
        // No swipe forward back into the closed sheet.
        window.setTimeout(leaveDeadEnd, 0);
      }
    };

    const addEntry = () => {
      if (cancelled) return;
      // Another sheet's entry is still coming off: wait until it has, then go in.
      if (popsInFlight > 0) {
        openingAfterPops.push(addEntry);
        return;
      }
      added = true;
      id = ++lastSheetId;
      // Keep the router's own state on the entry so it treats it as the same screen (never the
      // dead-end mark, or the entry would be stepped off like a dead end).
      const state = { ...stateWithoutDeadEnd(), latewatchSheet: id };
      if (pendingPops > 0 && sheetEntryId() !== null) {
        // A sheet that was closed and reopened straight away (or remounted) reuses the entry still
        // waiting to go.
        pendingPops -= 1;
        window.history.replaceState(state, '');
      } else if (isDeadEndEntry()) {
        // On the dead end left after a sheet closed: this sheet's entry takes its place.
        window.history.replaceState(state, '');
      } else {
        window.history.pushState(state, '');
      }
      window.addEventListener('popstate', onPopState);
    };

    // Effects run child first, so a child sheet opening together with its parent waits a tick:
    // the parent's entry goes in first and back closes the child (the top sheet) first.
    if (nested) queueMicrotask(addEntry);
    else addEntry();

    return () => {
      cancelled = true;
      if (!added) return;
      window.removeEventListener('popstate', onPopState);
      // Closed from the sheet (swipe down, a button), not by back: remove its entry. If the app has
      // already moved to another screen, the entry is behind it and is left alone.
      const top = sheetEntryId();
      if (!closedByBack && top !== null && top >= id) popSheetEntries();
    };
  }, [nested, open]);
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
  useCloseOnBack(props.open, props.onOpenChange, true);
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
    // Radix puts an inline pointer-events: auto on the backdrop, so this has to win over it (!): a
    // closed sheet's backdrop fades out for a moment and must not catch taps meant for the sheet below.
    className={cn('fixed inset-0 z-50 data-[state=closed]:pointer-events-none!', className)}
    {...props}
  />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & { hideHandle?: boolean }
>(({ className, children, hideHandle = false, onPointerDownOutside, ...props }, ref) => {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        onPointerDownOutside={(event) => {
          if (performance.now() - lastSheetOpenedAt < OPEN_GRACE_MS) event.preventDefault();
          onPointerDownOutside?.(event);
        }}
        className={cn(
          'drawer-glass fixed inset-x-[9px] bottom-[9px] z-50 mt-24 mx-auto flex h-auto flex-col overflow-hidden rounded-[38px] border border-border/50 shadow-2xl outline-none',
          // A sheet sliding away never catches a tap: it goes to what's underneath (the sheet below),
          // as on a phone. Otherwise a quick tap after a swipe down hits the leaving sheet and is
          // lost, or counts as a tap outside the sheet below and closes it. (!) beats the inline
          // pointer-events Radix sets.
          'data-[state=closed]:pointer-events-none!',
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
  );
});
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
