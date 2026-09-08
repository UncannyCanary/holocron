// A holocron: a crystalline cube seen from a corner, with the light inside.
// Drawn in the Ledger ink so it sits with the wordmark, and small enough to
// read at 22 pixels in the top bar.
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink"
    >
      {/* Three faces, each a shade of the paper, so the cube has form. */}
      <path d="M16 3 27.3 9.5 16 16 4.7 9.5Z" className="fill-card-raised" />
      <path d="M4.7 9.5 16 16v13L4.7 22.5Z" className="fill-panel-muted" />
      <path d="M16 16 27.3 9.5v13L16 29Z" className="fill-card" />
      {/* The knowledge inside. */}
      <path d="M16 11.5 20 16l-4 4.5-4-4.5Z" className="fill-verified-dot stroke-verified-dot" />
    </svg>
  );
}
