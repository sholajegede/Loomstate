import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card } from "./Page";
import { timeAgo } from "../lib/format";
import { readableError } from "../lib/errors";

const DIFF_TONE: Record<string, string> = {
  price: "border-warp/40 bg-warp/5",
  availability: "border-alarm/40 bg-alarm/5",
  gone: "border-alarm/40 bg-alarm/5",
  content: "border-ink-700 bg-ink-950/60",
  first_seen: "border-thread/30 bg-thread/5",
};

export function LiveWatches({
  loopId,
  sourceUrls,
}: {
  loopId: Id<"loops">;
  sourceUrls: string[];
}) {
  const data = useQuery(api.watches.forLoop, { loopId });
  const create = useMutation(api.watches.create);
  const setInterval = useMutation(api.watches.setInterval);
  const checkLoop = useAction(api.watches.checkLoopNow);
  const markSeen = useMutation(api.watches.markDiffsSeen);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const watched = new Set((data?.watches ?? []).map((w) => w.url));
  const candidates = sourceUrls.filter((url) => !watched.has(url));

  async function check() {
    setBusy(true);
    setNote(null);
    try {
      const result = await checkLoop({ loopId });
      setNote(result.detail);
    } catch (error) {
      setNote(readableError(error, "The check failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Live watches</h2>
            <p className="mt-1 text-sm text-ink-400">
              Loomstate re-reads these pages and reports what changed.
            </p>
          </div>
          <button
            onClick={() => void check()}
            disabled={busy || (data?.watches.length ?? 0) === 0}
            className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800 disabled:opacity-40"
          >
            {busy ? "Reading" : "Check now"}
          </button>
        </div>

        {note !== null ? (
          <p className="mt-3 rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 text-xs text-ink-300">
            {note}
          </p>
        ) : null}

        {(data?.watches ?? []).length > 0 ? (
          <ul className="mt-3 divide-y divide-ink-800 rounded-lg border border-ink-800">
            {data?.watches.map((watch) => (
              <li key={watch._id} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      watch.lastError !== undefined
                        ? "bg-alarm"
                        : watch.lastCrawlAt
                          ? "bg-thread"
                          : "bg-warp"
                    }`}
                  />
                  <a
                    href={watch.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-ink-200 hover:text-thread"
                  >
                    {watch.label}
                  </a>
                  {watch.price ? (
                    <span className="shrink-0 font-mono text-xs text-ink-100">
                      {watch.price}
                    </span>
                  ) : null}
                  {watch.availability && watch.availability !== "unknown" ? (
                    <span className="shrink-0 rounded-full border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300">
                      {watch.availability}
                    </span>
                  ) : null}
                  <select
                    value={watch.intervalMinutes}
                    onChange={(e) =>
                      void setInterval({
                        watchId: watch._id,
                        intervalMinutes: Number(e.target.value),
                      })
                    }
                    title="How often Loomstate re-reads this page"
                    className="shrink-0 rounded border border-ink-800 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-400 outline-none"
                  >
                    <option value={15}>15m</option>
                    <option value={60}>1h</option>
                    <option value={360}>6h</option>
                    <option value={1440}>1d</option>
                  </select>
                  <span className="w-16 shrink-0 text-right text-[11px] text-ink-400">
                    {watch.lastCrawlAt ? timeAgo(watch.lastCrawlAt) : "not read"}
                  </span>
                </div>
                {watch.excerpt ? (
                  <p className="mt-1 pl-3.5 text-xs text-ink-400">{watch.excerpt}</p>
                ) : null}
                {watch.lastError !== undefined ? (
                  <p className="mt-1 pl-3.5 text-xs text-alarm">{watch.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-400">
            No watch yet. Add a page below.
          </p>
        )}

        {candidates.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] text-ink-400">Pages from this loop</p>
            <div className="mt-1.5 space-y-1">
              {candidates.slice(0, 5).map((url) => (
                <button
                  key={url}
                  onClick={() => void create({ loopId, url })}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-ink-800 px-2.5 py-1.5 text-left hover:border-thread/40"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-300">
                    {url}
                  </span>
                  <span className="shrink-0 text-[11px] text-thread">Watch</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://..."
            className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-thread/60"
          />
          <button
            onClick={() => {
              void create({ loopId, url: draft.trim() }).then(() => setDraft(""));
            }}
            disabled={draft.trim() === ""}
            className="rounded-lg border border-ink-700 px-3 py-2 text-sm hover:bg-ink-800 disabled:opacity-40"
          >
            Watch
          </button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">What changed</h2>
          {(data?.diffs ?? []).some((d) => d.seenAt === undefined) ? (
            <button
              onClick={() => void markSeen({ loopId })}
              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
            >
              Mark read
            </button>
          ) : null}
        </div>

        {(data?.diffs ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">
            Loomstate has not seen a change yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data?.diffs.map((diff) => (
              <li
                key={diff._id}
                className={`rounded-lg border px-3 py-2.5 ${
                  DIFF_TONE[diff.kind] ?? "border-ink-700"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-wide text-ink-400">
                    {diff.kind.replace("_", " ")}
                  </span>
                  <span className="text-[11px] text-ink-400">
                    {timeAgo(diff.detectedAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-100">{diff.summary}</p>
                {diff.before !== undefined || diff.after !== undefined ? (
                  <p className="mt-1 font-mono text-[11px] text-ink-400">
                    {diff.before ?? "none"} → {diff.after ?? "none"}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
