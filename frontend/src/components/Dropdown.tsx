import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../utils/format';

interface DropdownProps {
  /** Renders the trigger. `open` lets the trigger style itself while the menu is shown. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  /** Renders the menu content; call `close` after choosing an item. */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  label: string;
}

/* Click-outside and Escape-aware popover menu. */
export function Dropdown({ trigger, children, align = 'right', width = 'w-56', label }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-40 mt-2 origin-top rounded-lg border border-line bg-elevated py-1 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
            width,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  active?: boolean;
}

export function DropdownItem({ onSelect, children, icon, tone = 'default', active = false }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors',
        tone === 'danger' ? 'text-primary hover:bg-primary/10' : 'text-ink-secondary hover:bg-line/60 hover:text-ink',
        active && 'text-ink',
      )}
    >
      {icon && <span className="text-ink-muted">{icon}</span>}
      <span className="flex-1">{children}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
    </button>
  );
}
