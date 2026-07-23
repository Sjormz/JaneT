import React from 'react';

export const BRAND_MARK_COLORS = {
  ink: '#10121B',
  periwinkle: '#7C8CFF',
  mint: '#54E1C5',
} as const;

export interface BrandMarkProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * JaneT's compact Prompt-J mark. The geometry is intentionally simple so the
 * prompt chevron and hooked J remain distinct at small icon sizes.
 */
export default function BrandMark({
  size = 24,
  className,
  title,
}: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect x="1" y="1" width="22" height="22" rx="6" fill={BRAND_MARK_COLORS.ink} />
      <path
        d="M5.5 7.25 9.75 12 5.5 16.75"
        fill="none"
        stroke={BRAND_MARK_COLORS.periwinkle}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.35 7.25h4.3v6.65c0 2.1-1.12 3.3-3.05 3.3-1.22 0-2.17-.48-2.75-1.36"
        fill="none"
        stroke={BRAND_MARK_COLORS.mint}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
