// components/ui/button.tsx
import * as React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { HapticSwitch } from '@/components/ui/haptic-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Buttons look raised and press in when tapped, with a neutral shadow under them (no coloured
// glow) that turns into a sunken inner shadow while pressed. Solid buttons are one flat colour with
// a crisp darker bottom edge and a tight shadow, like a physical key; plain ones keep a light top
// edge. The press eases in quickly and springs back slowly (PRESS), so it feels smooth rather than
// snapping.
export const PRESS = 'transition-[color,background-color,border-color,box-shadow,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] active:duration-100 motion-reduce:transition-none';
const RAISED_SOLID = 'shadow-[inset_0_-2px_0_rgb(0_0_0/0.28),0_1px_1px_rgb(0_0_0/0.18),0_4px_8px_-3px_rgb(0_0_0/0.3)] active:shadow-[inset_0_3px_6px_rgb(0_0_0/0.35)]';
const RAISED_PLAIN = 'shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.08)] active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]';

const buttonVariants = cva(
  cn(PRESS, 'relative inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'),
  {
    variants: {
      variant: {
        default: cn('bg-primary text-primary-foreground hover:bg-primary/90', RAISED_SOLID),
        destructive: cn('bg-danger text-danger-foreground hover:bg-danger/90', RAISED_SOLID),
        outline: cn('border border-border bg-background hover:bg-card hover:text-foreground', RAISED_PLAIN),
        secondary: cn('bg-card text-foreground hover:bg-card/80', RAISED_PLAIN),
        ghost: 'hover:bg-card hover:text-foreground',
        glass: 'liquid-glass rounded-full border border-border/40 text-foreground shadow-sm ring-1 ring-inset ring-white/10 hover:brightness-105 active:brightness-95',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
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
