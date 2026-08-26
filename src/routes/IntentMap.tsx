import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { EmptyState, Page } from "../components/Page";
import { AlivenessBar, StatusTag, TypeTag } from "../components/LoopBits";
import { timeAgo } from "../lib/format";

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
      setNote(error instanceof Error ? error.message : "The run failed.");
    } finally {
      setBusy(false);
    }
  }

  const pending = stats?.unclustered ?? 0;

  return (
    <Page
      title="Intent map"
      lede="Every goal you started on the web and never closed. Loomstate builds each loop from your own browsing signal."
      actions={
        <button
          onClick={() => void rebuild()}
          disabled={busy}
          className="shrink-0 rounded-lg bg-thread px-3.5 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "Reading your signal"
            : pending > 0
              ? `Rebuild loops (${pending} new)`
              : "Rebuild loops"}
        </button>
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
          body="Loomstate needs browsing signal first. Pair a browser, browse as you normally do, then select Rebuild loops."
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
