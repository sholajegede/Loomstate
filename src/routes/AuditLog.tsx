import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { EmptyState, Page } from "../components/Page";
import { timeAgo } from "../lib/format";

const ACTOR_TONE: Record<string, string> = {
  agent: "border-thread/40 text-thread",
  user: "border-warp/40 text-warp",
  system: "border-ink-600 text-ink-400",
};

export default function AuditLog() {
  const entries = useQuery(api.auditLog.recent, { limit: 150 });

  return (
    <Page
      title="Audit log"
      lede="Every action Loomstate takes, the grant that allowed it, and the evidence behind it."
    >
      {entries === undefined ? (
        <p className="text-sm text-ink-400">Loading</p>
      ) : entries.length === 0 ? (
        <EmptyState title="No entries yet" body="Nothing has happened yet." />
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry._id}
              className="rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    ACTOR_TONE[entry.actorType] ?? "border-ink-700 text-ink-400"
                  }`}
                >
                  {entry.actorType}
                </span>
                <code className="font-mono text-[11px] text-ink-400">
                  {entry.action}
                </code>
                {entry.grantTier ? (
                  <span className="rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300">
                    under {entry.grantTier} grant
                  </span>
                ) : null}
                {entry.loopId && entry.loopTitle ? (
                  <Link
                    to={`/loops/${entry.loopId}`}
                    className="truncate text-[11px] text-ink-400 hover:text-thread"
                  >
                    {entry.loopTitle}
                  </Link>
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
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
