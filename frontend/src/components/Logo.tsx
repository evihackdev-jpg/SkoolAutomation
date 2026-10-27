import { cn } from '../utils/format';

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Minimal orbital mark: a red core with one tilted orbit and a satellite dot.
 * Geometry is kept identical to `public/logo.svg`, which the PNG icons are rendered from.
 */
export function Logo({ size = 28, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <ellipse
        cx="256"
        cy="256"
        rx="228"
        ry="95"
        transform="rotate(-25 256 256)"
        fill="none"
        stroke="#F52F43"
        strokeWidth="26"
        strokeOpacity="0.75"
      />
      <circle cx="256" cy="256" r="112" fill="#F52F43" />
      <circle cx="390" cy="126" r="40" fill="#F52F43" />
    </svg>
  );
}
