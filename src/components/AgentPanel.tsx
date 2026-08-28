import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card } from "./Page";
import { timeAgo, timeUntil } from "../lib/format";
import { readableError } from "../lib/errors";

type Loop = {
  _id: Id<"loops">;
  tier: string;
  contactEmail?: string;
  contactSource?: string;
  blockedReason?: string;
  lastWorkedAt?: number;
  agentPausedAt?: number;
  agentPauseReason?: string;
};

/**
 * A readout, not a form. Loomstate works the loop on its own; this says what it
 * is doing and why. The controls under "Manual controls" cover the cases the
 * agent cannot resolve by itself.
 */
export function AgentPanel({ loop }: { loop: Loop }) {
  const agent = useQuery(api.agents.forLoop, { loopId: loop._id });
  const grants = useQuery(api.grants.forLoop, { loopId: loop._id });
  const thread = useQuery(api.email.threadForLoop, { loopId: loop._id });

  const live = (grants ?? []).find((g) => g.active) ?? null;

  return (
    <>
      <Card>
        <h2 className="text-sm font-medium">Agent</h2>

        <Status loop={loop} hasAgent={agent !== undefined && agent !== null} />

        <dl className="mt-4 space-y-2.5">
          <Row label="Writes from">
            {agent ? (
              <span className="font-mono text-thread">{agent.inboxAddress}</span>
            ) : (
              <span className="text-ink-400">
                Loomstate creates an address on the first run.
              </span>
            )}
          </Row>

          <Row label="Writes to">
            {loop.contactEmail ? (
              <>
                <span className="font-mono text-ink-100">{loop.contactEmail}</span>
                {loop.contactSource ? (
                  <span className="mt-0.5 block text-[11px] text-ink-400">
                    read off{" "}
                    <a
                      href={loop.contactSource}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-thread"
                    >
                      the watched page
                    </a>
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-400">
                Not found on the watched pages yet.
              </span>
            )}
          </Row>

          <Row label="Authority">
            <span className="text-ink-100">{live?.tier ?? loop.tier}</span>
            <span className="mt-0.5 block text-[11px] text-ink-400">
              {live === null
                ? "Applied on the first run. "
                : `Renews ${timeUntil(live.expiresAt)}. `}
              <Link to="/settings" className="hover:text-thread">
                Change for every loop
              </Link>
            </span>
          </Row>

          <Row label="Last run">
            <span className="text-ink-100">
              {loop.lastWorkedAt === undefined
                ? "Not yet"
                : timeAgo(loop.lastWorkedAt)}
            </span>
          </Row>
        </dl>

        <Manual loop={loop} live={live} />
      </Card>

      {(thread ?? []).length > 0 ? (
        <Card>
          <h2 className="text-sm font-medium">Email on this loop</h2>
          <ul className="mt-3 space-y-2">
            {thread?.map((message) => (
              <li
                key={message._id}
                className={`rounded-lg border px-3 py-2.5 ${
                  message.direction === "outbound"
                    ? "border-ink-800 bg-ink-950/60"
                    : "border-thread/30 bg-thread/5"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-ink-400">
                    {message.direction === "outbound"
                      ? `to ${message.to.join(", ")}`
                      : `from ${message.from}`}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-400">
                    {timeAgo(message.sentAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-100">{message.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-300">
                  {message.body}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Status({ loop, hasAgent }: { loop: Loop; hasAgent: boolean }) {
  if (loop.agentPausedAt !== undefined) {
    return <PausedNotice loop={loop} />;
  }
  if (loop.blockedReason !== undefined) {
    return (
      <p className="mt-2 rounded-lg border border-warp/40 bg-warp/5 px-3 py-2 text-sm text-ink-100">
        {loop.blockedReason}
      </p>
    );
  }
  if (loop.tier === "watch") {
    return (
      <p className="mt-2 text-sm text-ink-400">
        The agent watches this loop and tells you. It sends nothing.
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-ink-400">
      {hasAgent
        ? "Loomstate works this loop on its own. It asks you only before an action that commits money or cannot be undone."
        : "Loomstate works this loop on its own within a few minutes of a change."}
    </p>
  );
}

function PausedNotice({ loop }: { loop: Loop }) {
  const resume = useMutation(api.loops.resumeAgent);
  return (
    <div className="mt-2 rounded-lg border border-alarm/40 bg-alarm/5 px-3 py-2.5">
      <p className="text-sm text-ink-100">
        {loop.agentPauseReason ?? "Loomstate stopped the agent on this loop."}
      </p>
      <p className="mt-1 text-[11px] text-ink-400">
        Read the email below before you let it start again.
      </p>
      <button
        onClick={() => void resume({ loopId: loop._id })}
        className="mt-2 rounded-lg border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800"
      >
        Let the agent work this loop again
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 shrink-0 text-[11px] leading-5 text-ink-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** The escape hatches. Closed by default, because the normal path needs none. */
function Manual({
  loop,
  live,
}: {
  loop: Loop;
  live: { _id: Id<"grants">; tier: string } | null;
}) {
  const workLoop = useAction(api.agent.workLoopNow);
  const propose = useAction(api.agent.proposeForApproval);
  const revoke = useMutation(api.grants.revoke);
  const setContact = useMutation(api.loops.setContact);
  const [open, setOpen] = useState(false);
  const [contact, setContactDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const result = await workLoop({ loopId: loop._id });
      setNote(result.detail);
    } catch (error) {
      setNote(readableError(error, "The agent run failed."));
    } finally {
      setBusy(false);
    }
  }

  async function raiseForApproval() {
    setBusy(true);
    setNote(null);
    try {
      const result = await propose({ loopId: loop._id });
      setNote(result.detail);
    } catch (error) {
      setNote(readableError(error, "Loomstate could not raise the action."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-ink-800 pt-3">
      <button
        onClick={() => setOpen((was) => !was)}
        className="text-[11px] text-ink-400 hover:text-ink-100"
      >
        {open ? "Hide manual controls" : "Manual controls"}
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <button
            onClick={() => void run()}
            disabled={busy}
            className="w-full rounded-lg border border-ink-700 px-3 py-2 text-sm hover:bg-ink-800 disabled:opacity-50"
          >
            {busy ? "The agent is working" : "Run the agent now"}
          </button>

          <div>
            <button
              onClick={() => void raiseForApproval()}
              disabled={busy}
              className="w-full rounded-lg border border-ink-700 px-3 py-2 text-sm hover:bg-ink-800 disabled:opacity-50"
            >
              {busy ? "Loomstate is working" : "Propose this action for approval"}
            </button>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
              Loomstate decides this loop's next action and puts it in the
              approval queue, even when it has settled that step already. It
              sends nothing. Approving writes to your own inbox, not to the
              loop's contact.
            </p>
          </div>

          <div>
            <p className="text-[11px] text-ink-400">
              {loop.contactEmail === undefined
                ? "Set the contact by hand if the page never prints one"
                : "Replace the contact Loomstate read off the page"}
            </p>
            <div className="mt-1 flex gap-2">
              <input
                value={contact}
                onChange={(e) => setContactDraft(e.target.value)}
                placeholder={loop.contactEmail ?? "seller@example.com"}
                className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm outline-none focus:border-thread/60"
              />
              <button
                onClick={() => {
                  void setContact({
                    loopId: loop._id,
                    contactEmail: contact.trim(),
                  }).then(() => setContactDraft(""));
                }}
                disabled={contact.trim() === ""}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm hover:bg-ink-800 disabled:opacity-40"
              >
                Set
              </button>
            </div>
            {loop.contactEmail !== undefined ? (
              <button
                onClick={() =>
                  void setContact({ loopId: loop._id, contactEmail: "" })
                }
                className="mt-1.5 text-[11px] text-ink-400 hover:text-alarm"
              >
                Remove this contact
              </button>
            ) : null}
          </div>

          {live !== null ? (
            <button
              onClick={() => void revoke({ grantId: live._id })}
              className="w-full rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:border-alarm/50 hover:text-alarm"
            >
              Revoke this loop's authority
            </button>
          ) : null}

          {note !== null ? (
            <p className="rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 text-xs text-ink-300">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
