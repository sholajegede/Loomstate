import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { EmptyState, Page } from "../components/Page";
import { duration, timeAgo } from "../lib/format";
import { Loading } from "../components/Loading";

export default function Signal() {
  const events = useQuery(api.events.recent, { limit: 80 });
  const stats = useQuery(api.events.stats);

  return (
    <Page
      title="Signal"
      lede="The browsing events your paired browser sends. Loomstate builds every loop from this stream."
      actions={
        stats === undefined ? null : (
          <div className="flex gap-6 text-right">
            <Stat label="Events" value={String(stats.total)} />
            <Stat label="Sites" value={String(stats.hosts)} />
            <Stat
              label="Last event"
              value={stats.lastAt === null ? "none" : timeAgo(stats.lastAt)}
            />
          </div>
        )
      }
    >
      {events === undefined ? (
        <Loading />
      ) : events.length === 0 ? (
        <EmptyState
          title="No events yet"
          body="Pair a browser in Settings. The extension sends a page as soon as you read it."
        />
      ) : (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-800">
          {events.map((event) => (
            <li
              key={event._id}
              className="flex items-baseline gap-4 bg-ink-900/40 px-4 py-3"
            >
              <span className="w-20 shrink-0 text-xs text-ink-400">
                {timeAgo(event.occurredAt)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-100">
                  {event.title === "" ? event.url : event.title}
                </p>
                <p className="truncate text-xs text-ink-400">{event.host}</p>
              </div>
              {event.query ? (
                <span className="shrink-0 rounded-full border border-warp/40 px-2 py-0.5 text-[11px] text-warp">
                  search
                </span>
              ) : null}
              <span className="w-14 shrink-0 text-right text-xs text-ink-400">
                {duration(event.dwellMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium tabular-nums">{value}</p>
      <p className="text-[11px] text-ink-400">{label}</p>
    </div>
  );
}
