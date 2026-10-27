import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover shadow-none hover:shadow-glow focus-visible:ring-primary/60',
  secondary:
    'bg-elevated text-ink border border-line hover:border-ink-muted hover:bg-line/60 focus-visible:ring-ink-muted/40',
  ghost: 'text-ink-secondary hover:text-ink hover:bg-elevated focus-visible:ring-ink-muted/40',
};

export function Button({
  variant = 'primary',
  icon,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
