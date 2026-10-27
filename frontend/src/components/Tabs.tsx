import type { ReactNode } from 'react';
import { cn } from '../utils/format';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  rightSlot?: ReactNode;
}

/* Underline tabs: the active tab gets a red underline and brighter text. */
export function Tabs<T extends string>({ items, value, onChange, ariaLabel, rightSlot }: TabsProps<T>) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line">
      <div role="tablist" aria-label={ariaLabel} className="-mb-px flex gap-6 overflow-x-auto">
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                'relative whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none',
                selected ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink-secondary',
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className={cn('ml-1.5 text-xs', selected ? 'text-ink-secondary' : 'text-ink-muted')}>
                  ({item.count})
                </span>
              )}
            </button>
          );
        })}
      </div>
      {rightSlot}
    </div>
  );
}
