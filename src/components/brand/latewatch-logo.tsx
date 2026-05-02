import Image from 'next/image';
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

const imageSizes = {
  lg: '44px',
  md: '36px',
  sm: '32px',
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
      className={cn('relative block shrink-0 overflow-hidden', markSizes[size], className)}
    >
      <Image
        src="/latewatch-logo.png"
        alt=""
        fill
        sizes={imageSizes[size]}
        className="object-contain"
        draggable={false}
      />
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
