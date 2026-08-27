/**
 * What Loomstate shows while it waits.
 *
 * The mark weaves itself: the teal weft is carried across the amber warp, one
 * row after another. It is the same loom as the logo, drawn a little larger,
 * so a wait looks like the product rather than a generic spinner.
 */

function WeavingMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="presentation">
      <rect width="32" height="32" rx="8" className="fill-ink-800" />

      {/* The warp is the frame. It holds while the weft moves. */}
      <path
        d="M12 5v22M20 5v22"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="loom-warp text-warp"
      />

      <path
        d="M7 10h18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="loom-weft text-thread"
      />
      <path
        d="M7 16h18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="loom-weft loom-weft-2 text-thread"
      />
      <path
        d="M7 22h18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="loom-weft loom-weft-3 text-thread"
      />
    </svg>
  );
}

/** Centred in whatever it is given, for a page or the whole window. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-3 py-12"
    >
      <WeavingMark className="h-11 w-11" />
      <p className="text-sm text-ink-400">{label}</p>
    </div>
  );
}

/** A small one for a list that is fetching its next page. */
export function LoadingRow({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 px-2 py-2">
      <WeavingMark className="h-4 w-4" />
      <span className="text-[11px] text-ink-400">{label}</span>
    </div>
  );
}
