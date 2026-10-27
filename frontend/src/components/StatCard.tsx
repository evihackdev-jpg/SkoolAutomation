import type { LucideIcon } from 'lucide-react';
import { cn } from '../utils/format';
import { toneClasses } from '../utils/icons';
import type { CommunityIconTone } from '../types';

interface StatCardProps {
  icon: LucideIcon;
  value: number | string;
  label: string;
  tone?: CommunityIconTone;
}

export function StatCard({ icon: Icon, value, label, tone = 'red' }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-line bg-card px-5 py-4 transition-colors duration-200 hover:border-ink-muted/40">
      <span className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', toneClasses[tone])}>
        <Icon size={20} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none tabular-nums text-ink">{value}</p>
        <p className="mt-1.5 text-[13px] text-ink-secondary">{label}</p>
      </div>
    </div>
  );
}
