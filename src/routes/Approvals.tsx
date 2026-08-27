import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePasskeyAuth } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card, EmptyState, Page } from "../components/Page";
import { timeAgo } from "../lib/format";
import { readableError } from "../lib/errors";
import { Loading } from "../components/Loading";

type Payload = { to?: string[]; subject?: string; body?: string; from?: string };

export default function Approvals() {
  const approvals = useQuery(api.approvals.pending);
  // The extension hands a step-up action over by opening this page at it.
  const [params] = useSearchParams();
  const focused = params.get("approval");

  return (
    <Page
      title="Approvals"
      lede="Actions that commit money or cannot be undone wait here. You approve, edit, or reject each one."
    >
      {approvals === undefined ? (
        <Loading />
      ) : approvals.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="The agent has no action that needs your decision."
        />
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval._id}
              approval={approval}
              focused={approval._id === focused}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

function ApprovalCard({
  approval,
  focused = false,
}: {
  approval: NonNullable<
    ReturnType<typeof useQuery<typeof api.approvals.pending>>
  >[number];
  focused?: boolean;
}) {
  const approve = useAction(api.approvals.approveAndSend);
  const reject = useMutation(api.approvals.reject);
  const edit = useMutation(api.approvals.edit);
  const confirmStepUp = useMutation(api.approvals.confirmStepUp);
  const { signInWithPasskey } = usePasskeyAuth();

  const payload = (approval.actionPayload ?? {}) as Payload;
  const [subject, setSubject] = useState(payload.subject ?? "");
  const [body, setBody] = useState(payload.body ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const stepUpFresh =
    approval.stepUpConfirmedAt !== undefined &&
    Date.now() - approval.stepUpConfirmedAt < 5 * 60 * 1000;
  const gated = approval.stepUpRequired && !stepUpFresh;

  const card = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  async function doStepUp() {
    setBusy(true);
    setNote(null);
    try {
      await signInWithPasskey();
      await confirmStepUp({ approvalId: approval._id });
      setNote("Loomstate confirmed your identity. You can approve now.");
    } catch (error) {
      setNote(readableError(error, "The identity check did not finish."));
    } finally {
      setBusy(false);
    }
  }

  async function doApprove() {
    setBusy(true);
    setNote(null);
    try {
      if (editing) {
        await edit({
          approvalId: approval._id,
          subject,
          body,
          to: payload.to ?? [],
        });
      }
      const result = await approve({ approvalId: approval._id });
      setNote(result.detail);
    } catch (error) {
      setNote(readableError(error, "The send failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={card}>
      <Card className={focused ? "border-thread/50 ring-1 ring-thread/30" : ""}>
      {focused ? (
        <p className="mb-3 rounded-lg border border-thread/30 bg-thread/5 px-3 py-2 text-xs text-ink-200">
          Your browser sent you here to finish this one.
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/loops/${approval.loopId}`}
            className="text-sm font-medium hover:text-thread"
          >
            {approval.loopTitle}
          </Link>
          <p className="mt-1 text-sm text-ink-400">{approval.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RiskTag level={approval.riskLevel} />
          {approval.commitsMoney ? (
            <span className="rounded-full border border-alarm/50 px-2 py-0.5 text-[11px] text-alarm">
              commits money
            </span>
          ) : null}
          {!approval.reversible ? (
            <span className="rounded-full border border-alarm/50 px-2 py-0.5 text-[11px] text-alarm">
              cannot undo
            </span>
          ) : null}
          <span className="text-[11px] text-ink-400">
            {timeAgo(approval.createdAt)}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/60 p-4">
        <p className="text-[11px] text-ink-400">
          From {approval.agentAddress} to {(payload.to ?? []).join(", ")}
        </p>
        {editing ? (
          <>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-2 w-full rounded border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm outline-none focus:border-thread/60"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="mt-2 w-full rounded border border-ink-700 bg-ink-900 px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-thread/60"
            />
          </>
        ) : (
          <>
            <p className="mt-2 text-sm font-medium text-ink-100">{subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-300">
              {body}
            </p>
          </>
        )}
      </div>

      {approval.evidence.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] text-ink-400">Evidence behind this action</p>
          <ul className="mt-1.5 space-y-1">
            {approval.evidence.map((item, index) => (
              <li
                key={index}
                className="rounded-lg border border-ink-800 px-3 py-2 text-xs"
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
                <span className="ml-2 text-ink-400">
                  seen {timeAgo(item.observedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {gated ? (
        <div className="mt-4 rounded-lg border border-alarm/40 bg-alarm/5 p-3">
          <p className="text-sm text-ink-100">
            This action needs a fresh identity check.
          </p>
          <p className="mt-1 text-xs text-ink-400">
            Loomstate asks for your passkey again before it releases an action
            that commits money or cannot be undone.
          </p>
          <button
            onClick={() => void doStepUp()}
            disabled={busy}
            className="mt-2.5 rounded-lg bg-alarm px-3 py-1.5 text-xs font-medium text-ink-950 hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Waiting for your passkey" : "Confirm with a passkey"}
          </button>
        </div>
      ) : null}

      {note !== null ? (
        <p className="mt-3 text-xs text-ink-300">{note}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => void doApprove()}
          disabled={busy || gated}
          className="rounded-lg bg-thread px-3.5 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Sending" : "Approve and send"}
        </button>
        <button
          onClick={() => setEditing((was) => !was)}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm hover:bg-ink-800"
        >
          {editing ? "Stop editing" : "Edit"}
        </button>
        <button
          onClick={() => void reject({ approvalId: approval._id })}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-ink-300 hover:border-alarm/50 hover:text-alarm"
        >
          Reject
        </button>
      </div>
      </Card>
    </div>
  );
}

function RiskTag({ level }: { level: string }) {
  const tone =
    level === "high"
      ? "border-alarm/50 text-alarm"
      : level === "medium"
        ? "border-warp/50 text-warp"
        : "border-ink-700 text-ink-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {level} risk
    </span>
  );
}

export type ApprovalId = Id<"approvals">;
