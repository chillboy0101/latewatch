import { cn } from '@/lib/utils';

type LoadingBufferProps = {
  className?: string;
  description?: string;
  label?: string;
  variant?: 'page' | 'screen' | 'section' | 'inline';
};

export function LoadingBuffer({
  className,
  description = 'Preparing the latest system data.',
  label = 'Loading',
  variant = 'section',
}: LoadingBufferProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center text-center',
        variant === 'page' && 'pointer-events-none fixed bottom-0 left-64 right-0 top-16 z-30',
        variant === 'screen' && 'min-h-screen w-full',
        variant === 'section' && 'min-h-48 w-full py-8',
        variant === 'inline' && 'w-full py-8',
        className,
      )}
    >
      <div className="flex flex-col items-center">
        <div className="loading-buffer-spinner" aria-hidden="true">
          <span className="loading-buffer-ring" />
          <span className="loading-buffer-core" />
          <span className="loading-buffer-dot" />
        </div>
        <span className="sr-only">
          {label}
          {description ? `. ${description}` : ''}
        </span>
      </div>
    </div>
  );
}
