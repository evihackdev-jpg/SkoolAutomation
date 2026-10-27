import { Search } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../utils/format';

interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  /** Use the compact variant inside the top bar. */
  compact?: boolean;
}

export function SearchBar({ value, onValueChange, label, compact = false, className, ...rest }: SearchBarProps) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{label}</span>
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={label}
        className={cn(
          'w-full rounded-lg border border-line bg-card pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted transition-colors duration-150 hover:border-ink-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
          compact ? 'h-9' : 'h-10',
        )}
        {...rest}
      />
    </label>
  );
}
