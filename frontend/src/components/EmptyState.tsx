import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-card/60 px-6 py-12 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-ink-muted">
        <Icon size={20} />
      </span>
      <div>
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        <p className="mt-1 max-w-sm text-[13px] text-ink-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}
