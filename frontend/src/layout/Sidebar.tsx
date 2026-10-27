import {
  Bot,
  Compass,
  LayoutDashboard,
  CheckCheck,
  FileCheck2,
  UserCog,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { cn } from '../utils/format';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

/* Only live workspace features belong in the primary navigation. */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Auto Mode', to: '/auto-mode', icon: Bot },
  { label: 'Published Posts', to: '/published-posts', icon: FileCheck2 },
  { label: 'Discover', to: '/discover', icon: Compass },
  { label: 'Communities I Joined', to: '/joined-communities', icon: CheckCheck },
  { label: 'Accounts', to: '/accounts', icon: UserCog },
  { label: 'Settings', to: '/settings', icon: Settings },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <div className="flex h-full w-[232px] flex-col border-r border-line bg-sidebar">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Logo />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-ink">Skool Automation</p>
          <p className="text-[11px] text-ink-muted">Your community workspace</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 px-3 py-2">
        {navItems.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={label}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-primary/15 text-ink before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-primary'
                  : 'text-ink-muted hover:bg-elevated hover:text-ink-secondary',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} strokeWidth={2} className={cn(isActive ? 'text-primary' : 'text-ink-muted group-hover:text-ink-secondary')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line px-5 py-4 text-[11px] text-ink-muted">Your private community workspace</div>
    </div>
  );
}
