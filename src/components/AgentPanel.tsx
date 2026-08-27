import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card } from "./Page";
import { TIERS } from "./LoopBits";
import { timeAgo, timeUntil } from "../lib/format";
import { readableError } from "../lib/errors";

export function AgentPanel({ loopId }: { loopId: Id<"loops"> }) {
  const agent = useQuery(api.agents.forLoop, { loopId });
  const grants = useQuery(api.grants.forLoop, { loopId });
  const thread = useQuery(api.email.threadForLoop, { loopId });
  const grant = useMutation(api.grants.grant);
  const revoke = useMutation(api.grants.revoke);
  const workLoop = useAction(api.agent.workLoopNow);
  const provision = useAction(api.agents.provision);

  const [recipient, setRecipient] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const live = (grants ?? []).find((g) => g.active) ?? null;

  /** Gives the loop an agent if it has none, then records the grant. */
  async function setAuthority(tier: "watch" | "draft" | "act") {
    setBusy(true);
    setNote(null);
    try {
      const agentId =
        agent === undefined || agent === null
          ? (await provision({ loopId })).agentId
          : agent._id;
      await grant({ loopId, agentId, tier });
      setNote(`The agent now holds ${tier} authority on this loop.`);
    } catch (error) {
      setNote(readableError(error, "Loomstate could not set the authority."));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const result = await workLoop({
        loopId,
        recipient: recipient.trim() === "" ? undefined : recipient.trim(),
        instruction: instruction.trim() === "" ? undefined : instruction.trim(),
      });
      setNote(result.detail);
    } catch (error) {
      setNote(readableError(error, "The agent run failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">Agent</h2>
            <p className="mt-1 text-sm text-ink-400">
              {agent === undefined || agent === null
                ? "This loop has no agent yet. Loomstate creates one the first time it works the loop."
                : "The agent sends and receives email from its own address."}
            </p>
          </div>
        </div>

        {agent ? (
          <p className="mt-3 truncate rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 font-mono text-xs text-thread">
            {agent.inboxAddress}
          </p>
        ) : null}

        <div className="mt-3">
          <p className="text-[11px] text-ink-400">Authority</p>
          <div className="mt-1.5 space-y-1.5">
            {TIERS.map((tier) => (
              <button
                key={tier.id}
                onClick={() => void setAuthority(tier.id)}
                disabled={busy}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  live?.tier === tier.id
                    ? "border-thread/50 bg-thread/5"
                    : "border-ink-800 hover:border-ink-600"
                }`}
              >
                <p className="text-sm text-ink-100">{tier.label}</p>
                <p className="text-[11px] text-ink-400">{tier.help}</p>
              </button>
            ))}
          </div>
        </div>

        {live !== null ? (
          <div className="mt-3 rounded-lg border border-ink-800 px-3 py-2">
            <p className="text-[11px] text-ink-400">
              Grant expires {timeUntil(live.expiresAt)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-ink-300">
              {live.allowedActions.join(", ") || "no outbound action"}
            </p>
            <button
              onClick={() => void revoke({ grantId: live._id })}
              className="mt-2 w-full rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:border-alarm/50 hover:text-alarm"
            >
              Revoke now
            </button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-400">
            No live grant. Every action the agent proposes goes to the approval
            queue.
          </p>
        )}

        <div className="mt-3">
          <p className="text-[11px] text-ink-400">Who should the agent write to</p>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="seller@example.com"
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-thread/60"
          />
        </div>

        <div className="mt-3">
          <p className="text-[11px] text-ink-400">
            What should the agent do (optional)
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="Ask if the phone is still available"
            className="mt-1 w-full resize-none rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-thread/60"
          />
        </div>

        <button
          onClick={() => void run()}
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-thread px-3 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "The agent is working" : "Work this loop now"}
        </button>

        {note !== null ? (
          <p className="mt-2 rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 text-xs text-ink-300">
            {note}
          </p>
        ) : null}
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
