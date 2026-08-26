const TYPE_LABEL: Record<string, string> = {
  buying: "Buying",
  research: "Research",
  planning: "Planning",
  other: "Open",
};

const STATUS_STYLE: Record<string, string> = {
  active: "border-thread/40 text-thread",
  stalled: "border-warp/40 text-warp",
  dormant: "border-ink-600 text-ink-400",
  closed: "border-ink-700 text-ink-400",
};

export function TypeTag({ type }: { type: string }) {
  return (
    <span className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300">
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        STATUS_STYLE[status] ?? "border-ink-700 text-ink-400"
      }`}
    >
      {status}
    </span>
  );
}

/** A short bar that shows how live a loop is. */
export function AlivenessBar({ value }: { value: number }) {
  const tone =
    value >= 55 ? "bg-thread" : value >= 25 ? "bg-warp" : "bg-ink-600";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-ink-400">{value}</span>
    </div>
  );
}

export const TIERS = [
  { id: "watch", label: "Watch", help: "The agent monitors and tells you." },
  { id: "draft", label: "Draft", help: "The agent prepares the email. You send it." },
  { id: "act", label: "Act", help: "The agent sends low-stakes email itself." },
] as const;
