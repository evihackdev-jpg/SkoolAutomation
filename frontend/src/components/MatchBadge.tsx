import { cn } from '../utils/format';

interface MatchBadgeProps {
  score: number;
  size?: 'sm' | 'md';
}

/* Green badge for AI match scores — the only green element in the palette. */
export function MatchBadge({ score, size = 'md' }: MatchBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-bg font-semibold text-success',
        size === 'md' ? 'px-2.5 py-0.5 text-xs' : 'px-2 py-px text-[11px]',
      )}
      title={`AI match score: ${score}%`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
      {score}% match
    </span>
  );
}
