import { cn } from '@/lib/utils';

type LateWatchLogoProps = {
  className?: string;
  markSize?: 'sm' | 'md' | 'lg';
  subtitle?: string;
  title?: string;
};

const markSizes = {
  lg: 'h-11 w-11',
  md: 'h-9 w-9',
  sm: 'h-8 w-8',
};

export function LateWatchMark({
  className,
  size = 'md',
}: {
  className?: string;
  size?: keyof typeof markSizes;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative grid shrink-0 place-items-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15',
        markSizes[size],
        className,
      )}
    >
      <span className="absolute inset-[18%] rounded-full border-2 border-primary/20 border-r-primary/50 border-t-primary" />
      <span className="h-[34%] w-[34%] rounded-full bg-primary shadow-[0_0_0_0.28rem_color-mix(in_srgb,var(--primary)_14%,transparent)]" />
      <span className="absolute right-[18%] top-[18%] h-[18%] w-[18%] rounded-full border border-background bg-primary shadow-[0_0_0_2px_color-mix(in_srgb,var(--primary)_22%,transparent)]" />
    </span>
  );
}

export function LateWatchLogo({
  className,
  markSize = 'md',
  subtitle,
  title = 'LateWatch',
}: LateWatchLogoProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <LateWatchMark size={markSize} />
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold leading-tight">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
