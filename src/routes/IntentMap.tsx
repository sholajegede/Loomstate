import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { EmptyState, Page } from "../components/Page";
import { AlivenessBar, StatusTag, TypeTag } from "../components/LoopBits";
import { timeAgo } from "../lib/format";
import { readableError } from "../lib/errors";

export default function IntentMap() {
  const loops = useQuery(api.loops.list);
  const stats = useQuery(api.events.stats);
  const reconstruct = useAction(api.loops.reconstruct);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function rebuild() {
    setBusy(true);
    setNote(null);
    try {
      const result = await reconstruct({});
      setNote(result.detail);
    } catch (error) {
      setNote(readableError(error, "The run failed."));
    } finally {
      setBusy(false);
    }
  }

  const pending = stats?.unclustered ?? 0;

  return (
    <Page
      title="Intent map"
      lede="Every goal you started on the web and never closed. Loomstate builds each loop from your browsing, watches the pages behind it, and works it without being asked."
      actions={
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full bg-thread" />
            Loomstate is building loops on its own
          </span>
          <button
            onClick={() => void rebuild()}
            disabled={busy}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
          >
            {busy
              ? "Re-scanning"
              : pending > 0
                ? `Re-scan now (${pending} new pages)`
                : "Re-scan now"}
          </button>
        </div>
      }
    >
      {note !== null ? (
        <p className="mb-4 rounded-lg border border-ink-800 bg-ink-900/60 px-4 py-2.5 text-sm text-ink-300">
          {note}
        </p>
      ) : null}

      {loops === undefined ? (
        <p className="text-sm text-ink-400">Loading</p>
      ) : loops.length === 0 ? (
        <EmptyState
          title="No loops yet"
          body="Loomstate needs browsing signal first. Pair a browser and browse as you normally do. Loops appear here on their own within a few minutes."
          hint="Open Settings to pair a browser."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {loops.map((loop) => (
            <Link
              key={loop._id}
              to={`/loops/${loop._id}`}
              className="group rounded-xl border border-ink-800 bg-ink-900/60 p-5 transition-colors hover:border-ink-600"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-medium leading-snug text-ink-100 group-hover:text-white">
                  {loop.title}
                </h2>
                <AlivenessBar value={loop.aliveness} />
              </div>

              <p className="mt-2 line-clamp-2 text-sm text-ink-400">{loop.summary}</p>

              <div className="mt-3.5 rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2">
                <p className="text-[11px] text-ink-400">Next step</p>
                <p className="mt-0.5 text-sm text-ink-200">{loop.nextStep}</p>
              </div>

              {loop.blockedReason !== undefined ? (
                <p className="mt-2 truncate rounded-lg border border-warp/40 bg-warp/5 px-2.5 py-1.5 text-[11px] text-ink-200">
                  {loop.blockedReason}
                </p>
              ) : null}

              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <TypeTag type={loop.type} />
                <StatusTag status={loop.status} />
                <span className="text-[11px] text-ink-400">
                  {loop.eventCount} pages
                </span>
                <span className="ml-auto text-[11px] text-ink-400">
                  {timeAgo(loop.lastActivityAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
