/**
 * The Geeked logo: a rounded tile holding a prompt chevron and cursor. Drawn with the accent
 * token, so it follows the palette, accent and theme.
 */
export function GeekedMark({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      role="img"
      aria-label="Geeked"
      data-testid="geeked-mark"
    >
      <rect x="2" y="2" width="68" height="68" rx="18" fill="var(--accent)" />
      <path
        d="M22 25 L37 36 L22 47"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="42" y="45" width="15" height="6" rx="3" fill="var(--accent-fg)" />
    </svg>
  );
}
