import { useState } from "react";
import { NavLink } from "react-router-dom";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { timeAgo } from "../lib/format";

type Status = "active" | "stalled" | "dormant" | "closed";
type LoopType = "buying" | "research" | "planning" | "other";

const STATUSES: { id: Status; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "stalled", label: "Stalled" },
  { id: "dormant", label: "Dormant" },
  { id: "closed", label: "Closed" },
];

const TYPES: { id: LoopType; label: string }[] = [
  { id: "buying", label: "Buying" },
  { id: "research", label: "Research" },
  { id: "planning", label: "Planning" },
  { id: "other", label: "Open" },
];

const ALIVENESS: { id: number; label: string }[] = [
  { id: 0, label: "Any" },
  { id: 25, label: "25+" },
  { id: 55, label: "55+" },
  { id: 80, label: "80+" },
];

const DOT: Record<string, string> = {
  active: "bg-thread",
  stalled: "bg-warp",
  dormant: "bg-ink-600",
  closed: "bg-ink-700",
};

/** The loops list that stays in the nav, whatever page you are on. */
export function LoopsSidebar() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [type, setType] = useState<LoopType | null>(null);
  const [minAliveness, setMinAliveness] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const counts = useQuery(api.loops.statusCounts);
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.loops.page,
    {
      search: search.trim() === "" ? undefined : search.trim(),
      status: status ?? undefined,
      type: type ?? undefined,
      minAliveness: minAliveness === 0 ? undefined : minAliveness,
    },
    { initialNumItems: 25 },
  );

  const filtersOn =
    status !== null || type !== null || minAliveness !== 0 || search !== "";

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
          Loops {counts ? `· ${counts.total}` : ""}
        </p>
        <button
          onClick={() => setShowFilters((was) => !was)}
          className={`text-[11px] ${
            filtersOn ? "text-thread" : "text-ink-400 hover:text-ink-100"
          }`}
        >
          {showFilters ? "Hide" : "Filter"}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search loops"
        className="mx-1 rounded-lg border border-ink-800 bg-ink-950 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-400/70 focus:border-thread/50"
      />

      {showFilters ? (
        <div className="mx-1 mt-2 space-y-2 rounded-lg border border-ink-800 bg-ink-950/60 p-2">
          <FilterRow label="Status">
            <Chip active={status === null} onClick={() => setStatus(null)}>
              All
            </Chip>
            {STATUSES.map((s) => (
              <Chip
                key={s.id}
                active={status === s.id}
                onClick={() => setStatus(status === s.id ? null : s.id)}
              >
                {s.label}
                {counts ? ` ${counts[s.id]}` : ""}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Type">
            <Chip active={type === null} onClick={() => setType(null)}>
              All
            </Chip>
            {TYPES.map((t) => (
              <Chip
                key={t.id}
                active={type === t.id}
                onClick={() => setType(type === t.id ? null : t.id)}
              >
                {t.label}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label="Aliveness">
            {ALIVENESS.map((a) => (
              <Chip
                key={a.id}
                active={minAliveness === a.id}
                onClick={() => setMinAliveness(a.id)}
              >
                {a.label}
              </Chip>
            ))}
          </FilterRow>
        </div>
      ) : null}

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
        {pageStatus === "LoadingFirstPage" ? (
          <p className="px-2 py-3 text-[11px] text-ink-400">Loading</p>
        ) : results.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-ink-400">
            {filtersOn ? "No loop matches." : "No loops yet."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {results.map((loop) => (
              <li key={loop._id}>
                <NavLink
                  to={`/loops/${loop._id}`}
                  className={({ isActive }) =>
                    [
                      "block rounded-lg px-2.5 py-1.5 transition-colors",
                      isActive
                        ? "bg-ink-800"
                        : "hover:bg-ink-800/60",
                    ].join(" ")
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        loop.agentPausedAt !== undefined
                          ? "bg-alarm"
                          : (DOT[loop.status] ?? "bg-ink-600")
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                      {loop.title}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-400">
                      {loop.aliveness}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate pl-3 text-[10px] text-ink-400">
                    {loop.agentPausedAt !== undefined
                      ? "stopped for review"
                      : `${loop.status} · ${timeAgo(loop.lastActivityAt)}`}
                  </p>
                </NavLink>
              </li>
            ))}
          </ul>
        )}

        {pageStatus === "CanLoadMore" ? (
          <button
            onClick={() => loadMore(25)}
            className="mt-1 w-full rounded-lg border border-ink-800 px-2 py-1.5 text-[11px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          >
            Load more
          </button>
        ) : null}
        {pageStatus === "LoadingMore" ? (
          <p className="px-2 py-2 text-[11px] text-ink-400">Loading more</p>
        ) : null}
      </div>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? "border-thread/50 bg-thread/10 text-thread"
          : "border-ink-800 text-ink-400 hover:border-ink-600 hover:text-ink-200"
      }`}
    >
      {children}
    </button>
  );
}
