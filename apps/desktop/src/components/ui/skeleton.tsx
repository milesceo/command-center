import { cn } from '../../lib/cn';

/** A pulsing placeholder block. Decorative: pair it with a labelled `Loading` wrapper. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-hover', className)} />;
}

/** Placeholder for a full-width view that is still loading. */
export function ViewSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-5"
    >
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Placeholder rows for the sidebar list while conversations load. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading conversations"
      className="flex flex-col gap-1.5 px-3 py-2"
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-7', i % 3 === 1 ? 'w-4/5' : 'w-full')} />
      ))}
    </div>
  );
}
