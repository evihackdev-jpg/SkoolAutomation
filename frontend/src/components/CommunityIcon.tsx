import { getCommunityIcon, toneClasses } from '../utils/icons';
import type { CommunityIconTone } from '../types';
import { cn } from '../utils/format';

interface CommunityIconProps {
  iconName: string;
  tone: CommunityIconTone;
  size?: 'sm' | 'md';
}

export function CommunityIcon({ iconName, tone, size = 'md' }: CommunityIconProps) {
  const Icon = getCommunityIcon(iconName);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg',
        size === 'md' ? 'h-10 w-10' : 'h-8 w-8',
        toneClasses[tone],
      )}
      aria-hidden="true"
    >
      <Icon size={size === 'md' ? 20 : 16} strokeWidth={2} />
    </span>
  );
}
