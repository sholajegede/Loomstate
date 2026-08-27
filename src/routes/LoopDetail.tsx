import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card, EmptyState, Page } from "../components/Page";
import { AlivenessBar, StatusTag, TypeTag } from "../components/LoopBits";
import { duration, timeAgo } from "../lib/format";
import { LiveWatches } from "../components/Watches";
import { AgentPanel } from "../components/AgentPanel";
import { Chat } from "../components/Chat";

export default function LoopDetail() {
  const { loopId } = useParams();
  const navigate = useNavigate();
  const data = useQuery(
    api.loops.get,
    loopId === undefined ? "skip" : { loopId: loopId as Id<"loops"> },
  );
  const close = useMutation(api.loops.close);
  const remove = useMutation(api.loops.remove);

  if (data === undefined) {
    return (
      <Page title="Loop" lede="One goal, its evidence, and the work the agent does on it.">
        <p className="text-sm text-ink-400">Loading</p>
      </Page>
    );
  }

  if (data === null) {
    return (
      <Page title="Loop" lede="One goal, its evidence, and the work the agent does on it.">
        <EmptyState
          title="Loop not found"
          body="This loop no longer exists, or it belongs to another workspace."
        />
      </Page>
    );
  }

  const { loop, events } = data;

  return (
    <Page
      title={loop.title}
      lede={loop.summary}
      actions={
        <div className="flex shrink-0 items-center gap-3">
          <AlivenessBar value={loop.aliveness} />
          <Link to="/" className="text-sm text-ink-400 hover:text-ink-100">
            Back
          </Link>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TypeTag type={loop.type} />
        <StatusTag status={loop.status} />
        <span className="text-[11px] text-ink-400">{loop.eventCount} pages</span>
        <span className="text-[11px] text-ink-400">
          last read {timeAgo(loop.lastActivityAt)}
        </span>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Card>
            <p className="text-[11px] text-ink-400">Next step</p>
            <p className="mt-1 text-sm text-ink-100">{loop.nextStep}</p>
            {loop.blockedReason !== undefined ? (
              <p className="mt-2 rounded-lg border border-warp/40 bg-warp/5 px-3 py-2 text-xs text-ink-200">
                {loop.blockedReason}
              </p>
            ) : null}
          </Card>

          <div className="flex h-[26rem] flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900/60">
            <Chat loopId={loop._id} title="Ask about this loop" />
          </div>

          <LiveWatches loopId={loop._id} sourceUrls={loop.sourceUrls} />

          <Card>
            <h2 className="text-sm font-medium">Pages behind this loop</h2>
            <ul className="mt-3 divide-y divide-ink-800">
              {events.map((event) => (
                <li key={event._id} className="flex items-baseline gap-3 py-2.5">
                  <span className="w-20 shrink-0 text-xs text-ink-400">
                    {timeAgo(event.occurredAt)}
                  </span>
                  <a
                    href={event.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-ink-200 hover:text-thread"
                  >
                    {event.title === "" ? event.url : event.title}
                  </a>
                  <span className="w-12 shrink-0 text-right text-xs text-ink-400">
                    {duration(event.dwellMs)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <AgentPanel loop={loop} />

          <Card>
            <h2 className="text-sm font-medium">Keywords</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {loop.keywords.map((word) => (
                <span
                  key={word}
                  className="rounded-full border border-ink-800 px-2 py-0.5 text-[11px] text-ink-300"
                >
                  {word}
                </span>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-medium">Close this loop</h2>
            <p className="mt-1 text-sm text-ink-400">
              The agent stops all work on a closed loop. Removing it deletes its
              email, approvals, and watches. The pages you read are kept.
            </p>
            <button
              onClick={() => {
                void close({ loopId: loop._id }).then(() => navigate("/"));
              }}
              className="mt-3 w-full rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:border-alarm/50 hover:text-alarm"
            >
              Close loop
            </button>
            <button
              onClick={() => {
                void remove({ loopId: loop._id }).then(() => navigate("/"));
              }}
              className="mt-2 w-full rounded-lg border border-alarm/40 px-3 py-2 text-sm text-alarm hover:bg-alarm/10"
            >
              Remove loop and its data
            </button>
          </Card>
        </div>
      </div>
    </Page>
  );
}
