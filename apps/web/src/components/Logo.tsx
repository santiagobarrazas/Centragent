// Centragent logomark — an aperture "C": a near-closed ring (one gap opening
// right) around a flat indigo node = agents converging on the control-plane
// center. Drawn as a dashed circle so it renders crisply at every size. The ring
// uses currentColor (inherits theme); the indigo accent is fixed.
export function Logo({
  size = 28,
  className
}: {
  size?: number;
  className?: string | undefined;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Centragent"
      className={className}
    >
      <circle
        cx="16"
        cy="16"
        r="12"
        stroke="currentColor"
        strokeWidth="3.4"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="63 12.4"
        transform="rotate(30 16 16)"
      />
      <circle cx="16" cy="16" r="4" fill="#6366f1" />
    </svg>
  );
}
