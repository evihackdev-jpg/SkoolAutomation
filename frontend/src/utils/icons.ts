import {
  Bot,
  Blocks,
  Clapperboard,
  Coins,
  GraduationCap,
  HeartPulse,
  Layers,
  PenTool,
  Rocket,
  Sparkles,
  TrendingUp,
  type LucideIcon,
  Users,
} from 'lucide-react';
import type { CommunityIconTone } from '../types';

/* Shared icons and color tones used by workspace components. */
const iconMap: Record<string, LucideIcon> = {
  Bot,
  Blocks,
  Clapperboard,
  Coins,
  GraduationCap,
  HeartPulse,
  Layers,
  PenTool,
  Rocket,
  Sparkles,
  TrendingUp,
  Users,
};

export function getCommunityIcon(name: string): LucideIcon {
  return iconMap[name] ?? Users;
}

/* Tailwind classes for the tinted square behind community icons and avatars. */
export const toneClasses: Record<CommunityIconTone, string> = {
  red: 'bg-primary/15 text-primary',
  orange: 'bg-orange-500/15 text-orange-400',
  blue: 'bg-blue-500/15 text-blue-400',
  purple: 'bg-violet-500/15 text-violet-400',
  green: 'bg-success/15 text-success',
  teal: 'bg-teal-500/15 text-teal-400',
};
