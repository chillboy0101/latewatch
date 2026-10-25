// components/ui/button.tsx
import * as React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { HapticSwitch } from '@/components/ui/haptic-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Buttons look raised and press in when tapped: a light top edge and a soft shadow under them, which
// turn into a sunken inner shadow while pressed (with the button nudged down a pixel).
// (Written out in full so Tailwind finds the classes.)
const RAISED_PRIMARY = 'shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.15),0_4px_12px_-4px_color-mix(in_oklab,var(--primary)_55%,transparent)] active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.25)]';
const RAISED_DANGER = 'shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.15),0_4px_12px_-4px_color-mix(in_oklab,var(--danger)_55%,transparent)] active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.25)]';
const RAISED_PLAIN = 'shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.08)] active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]';

const buttonVariants = cva(
  'relative inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform,filter] duration-150 active:translate-y-px active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: cn('bg-primary bg-linear-to-b from-white/12 to-transparent text-primary-foreground hover:bg-primary/90', RAISED_PRIMARY),
        destructive: cn('bg-danger bg-linear-to-b from-white/12 to-transparent text-danger-foreground hover:bg-danger/90', RAISED_DANGER),
        outline: cn('border border-border bg-background hover:bg-card hover:text-foreground', RAISED_PLAIN),
        secondary: cn('bg-card text-foreground hover:bg-card/80', RAISED_PLAIN),
        ghost: 'hover:bg-card hover:text-foreground',
        glass: 'liquid-glass rounded-full border border-border/40 text-foreground shadow-sm ring-1 ring-inset ring-white/10 hover:brightness-105 active:brightness-95',
        link: 'text-primary underline-offset-4 hover:underline active:translate-y-0 active:scale-100',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, children, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {/* Slottable keeps asChild working: the switch is added inside the child (a link). */}
        <Slottable>{children}</Slottable>
        <HapticSwitch />
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
