'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '@/lib/utils';

function Drawer({
  shouldScaleBackground = false,
  noBodyStyles = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
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
    className={cn('fixed inset-0 z-50', className)}
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
      {!hideHandle && (
        <div className="mx-auto mt-3 h-2 w-32 shrink-0 rounded-full bg-gradient-to-b from-muted-foreground/70 to-muted-foreground/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.18)] transition-colors hover:from-muted-foreground/85 hover:to-muted-foreground/60 active:from-muted-foreground/90" />
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
