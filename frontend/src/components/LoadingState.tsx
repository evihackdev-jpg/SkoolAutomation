import { cn } from '../utils/format';

interface LoadingStateProps {
  /** Number of placeholder rows to render. */
  rows?: number;
  className?: string;
}

/* Skeleton placeholder shown while a section would normally load data. */
export function LoadingState({ rows = 3, className }: LoadingStateProps) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-3 rounded-card border border-line bg-card p-4">
          <div className="h-10 w-10 rounded-lg bg-elevated" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-elevated" />
            <div className="h-3 w-2/3 rounded bg-elevated/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
