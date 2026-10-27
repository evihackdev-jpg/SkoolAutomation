import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/format';

interface CategoryChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filter chips toggle selection; tags are static labels. */
  selected?: boolean;
  as?: 'filter' | 'tag';
}

export function CategoryChip({ selected = false, as = 'filter', className, children, ...rest }: CategoryChipProps) {
  if (as === 'tag') {
    return (
      <span className="inline-flex items-center rounded-md border border-line bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        selected
          ? 'border-primary bg-primary text-white'
          : 'border-line bg-card text-ink-secondary hover:border-ink-muted hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
