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
  const setup = useQuery(api.setup.status);
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

      {loops === undefined || setup === undefined ? (
        <p className="text-sm text-ink-400">Loading</p>
      ) : loops.length === 0 && !setup.hasKey ? (
        <NeedsSetup />
      ) : loops.length === 0 ? (
        <EmptyState
          title="No loops yet"
          body={
            setup.pairedBrowsers === 0
              ? "Loomstate has your key but no browser to read. Connect one and browse as you normally do."
              : setup.hasSignal
                ? "Loomstate has your browsing and is working out the goals behind it. Loops appear here on their own within a few minutes."
                : "Loomstate is ready and waiting for your first pages. Browse as you normally do."
          }
          hint={
            setup.pairedBrowsers === 0
              ? "Open setup to connect a browser."
              : undefined
          }
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

/**
 * What the person sees before Loomstate can do anything. An empty loop screen
 * would sit there working silently on nothing, so this says what is missing.
 */
function NeedsSetup() {
  return (
    <div className="rounded-xl border border-thread/30 bg-thread/5 px-8 py-10 text-center">
      <p className="text-sm font-medium text-ink-100">
        Loomstate needs your OpenAI key first
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">
        Loomstate reads your browsing and works out the goals behind it. It uses
        your own key to do that, so it cannot build a single loop until you add
        one.
      </p>
      <Link
        to="/setup"
        className="mt-4 inline-block rounded-lg bg-thread px-4 py-2 text-sm font-medium text-ink-950 hover:opacity-90"
      >
        Finish setting up
      </Link>
    </div>
  );
}
