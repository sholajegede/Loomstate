import { useState } from "react";
import { Link } from "react-router-dom";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState, Page } from "../components/Page";
import { timeAgo, timeUntil } from "../lib/format";

const ACTOR_TONE: Record<string, string> = {
  agent: "border-thread/40 text-thread",
  user: "border-warp/40 text-warp",
  system: "border-ink-600 text-ink-400",
};

const WINDOWS = [
  { id: 0, label: "All time" },
  { id: 60 * 60 * 1000, label: "Last hour" },
  { id: 24 * 60 * 60 * 1000, label: "Last day" },
  { id: 7 * 24 * 60 * 60 * 1000, label: "Last week" },
];

/**
 * A read-only review of what the agents did. Two lenses: every agent together,
 * or one agent's own history. Nothing here changes anything.
 */
export default function AuditLog() {
  const [agentId, setAgentId] = useState<Id<"agents"> | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [loopId, setLoopId] = useState<Id<"loops"> | null>(null);
  const [windowMs, setWindowMs] = useState(0);

  const agents = useQuery(api.auditLog.agentSummaries);
  const kinds = useQuery(api.auditLog.actionKinds);

  const { results, status, loadMore } = usePaginatedQuery(
    api.auditLog.page,
    {
      agentId: agentId ?? undefined,
      loopId: agentId === null ? (loopId ?? undefined) : undefined,
      action: action ?? undefined,
      since: windowMs === 0 ? undefined : Date.now() - windowMs,
    },
    { initialNumItems: 30 },
  );

  const lensAgent = (agents ?? []).find((a) => a._id === agentId) ?? null;

  return (
    <Page
      title="Audit log"
      lede="Every action the agents took, the grant that allowed it, and the evidence behind it. This view only reads."
    >
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-400">
              Lens
            </p>
            <button
              onClick={() => setAgentId(null)}
              className={`mt-2 w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                agentId === null
                  ? "border-thread/50 bg-thread/5"
                  : "border-ink-800 hover:border-ink-600"
              }`}
            >
              <p className="text-xs text-ink-100">All agents</p>
              <p className="text-[10px] text-ink-400">
                Everything, as one history
              </p>
            </button>

            <div className="mt-2 space-y-1">
              {(agents ?? []).map((agent) => (
                <button
                  key={agent._id}
                  onClick={() => setAgentId(agent._id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    agentId === agent._id
                      ? "border-thread/50 bg-thread/5"
                      : "border-ink-800 hover:border-ink-600"
                  }`}
                >
                  <p className="truncate font-mono text-[10px] text-thread">
                    {agent.inboxAddress}
                  </p>
                  <p className="truncate text-[10px] text-ink-400">
                    {agent.loopTitle ?? "no loop"} · {agent.actions} actions
                  </p>
                </button>
              ))}
              {(agents ?? []).length === 0 ? (
                <p className="px-1 py-1 text-[10px] text-ink-400">
                  No agent has acted yet.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-400">
              When
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {WINDOWS.map((w) => (
                <Chip
                  key={w.id}
                  active={windowMs === w.id}
                  onClick={() => setWindowMs(w.id)}
                >
                  {w.label}
                </Chip>
              ))}
            </div>

            <p className="mt-3 text-[11px] uppercase tracking-wide text-ink-400">
              Action
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Chip active={action === null} onClick={() => setAction(null)}>
                All
              </Chip>
              {(kinds ?? []).slice(0, 12).map((k) => (
                <Chip
                  key={k.action}
                  active={action === k.action}
                  onClick={() => setAction(action === k.action ? null : k.action)}
                >
                  {k.action} {k.count}
                </Chip>
              ))}
            </div>
          </div>

          {loopId !== null && agentId === null ? (
            <button
              onClick={() => setLoopId(null)}
              className="w-full rounded-lg border border-ink-800 px-2.5 py-2 text-[11px] text-ink-300 hover:bg-ink-800"
            >
              Clear the loop filter
            </button>
          ) : null}
        </div>

        <div className="min-w-0">
          {lensAgent !== null ? (
            <div className="mb-3 rounded-xl border border-thread/30 bg-thread/5 px-4 py-3">
              <p className="font-mono text-xs text-thread">
                {lensAgent.inboxAddress}
              </p>
              <p className="mt-1 text-[11px] text-ink-400">
                {lensAgent.actions} recorded actions
                {lensAgent.lastActionAt !== null
                  ? `, last ${timeAgo(lensAgent.lastActionAt)}`
                  : ""}
                {lensAgent.loopTitle ? ` · ${lensAgent.loopTitle}` : ""}
              </p>
            </div>
          ) : null}

          {status === "LoadingFirstPage" ? (
            <p className="text-sm text-ink-400">Loading</p>
          ) : results.length === 0 ? (
            <EmptyState
              title="Nothing recorded here"
              body="No action matches this lens and these filters."
            />
          ) : (
            <ul className="space-y-2">
              {results.map((entry) => (
                <li
                  key={entry._id}
                  className="rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        ACTOR_TONE[entry.actorType] ??
                        "border-ink-700 text-ink-400"
                      }`}
                    >
                      {entry.actorType}
                    </span>
                    <code className="font-mono text-[11px] text-ink-400">
                      {entry.action}
                    </code>
                    {entry.grantTier ? (
                      <span
                        className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300"
                        title={
                          entry.grantActions
                            ? `allowed: ${entry.grantActions.join(", ") || "nothing outbound"}`
                            : undefined
                        }
                      >
                        under {entry.grantTier} grant
                        {entry.grantExpiresAt
                          ? ` · expires ${timeUntil(entry.grantExpiresAt)}`
                          : ""}
                      </span>
                    ) : null}
                    {entry.loopId && entry.loopTitle ? (
                      <button
                        onClick={() => {
                          setAgentId(null);
                          setLoopId(entry.loopId as Id<"loops">);
                        }}
                        className="truncate text-[11px] text-ink-400 hover:text-thread"
                      >
                        {entry.loopTitle}
                      </button>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[11px] text-ink-400">
                      {timeAgo(entry.at)}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm text-ink-200">{entry.detail}</p>

                  {entry.agentAddress ? (
                    <p className="mt-1 font-mono text-[11px] text-ink-400">
                      {entry.agentAddress}
                    </p>
                  ) : null}

                  {entry.evidence && entry.evidence.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {entry.evidence.map((item, index) => (
                        <li
                          key={index}
                          className="rounded-lg border border-ink-800 bg-ink-950/60 px-2.5 py-1.5 text-[11px]"
                        >
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ink-300 hover:text-thread"
                          >
                            {item.label}
                          </a>
                          <span className="ml-2 font-mono text-ink-400">
                            {item.before ?? "none"} → {item.after ?? "none"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {entry.result ? (
                    <p className="mt-2 whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-950/60 px-2.5 py-2 text-xs text-ink-400">
                      {entry.result}
                    </p>
                  ) : null}

                  {entry.loopId ? (
                    <Link
                      to={`/loops/${entry.loopId}`}
                      className="mt-2 inline-block text-[11px] text-ink-400 hover:text-thread"
                    >
                      Open the loop
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {status === "CanLoadMore" ? (
            <button
              onClick={() => loadMore(30)}
              className="mt-3 w-full rounded-lg border border-ink-800 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800"
            >
              Load more
            </button>
          ) : null}
          {status === "LoadingMore" ? (
            <p className="mt-3 text-sm text-ink-400">Loading more</p>
          ) : null}
        </div>
      </div>
    </Page>
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
