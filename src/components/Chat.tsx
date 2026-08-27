import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { timeAgo } from "../lib/format";
import { readableError } from "../lib/errors";
import { useDictation } from "../lib/speech";
import { AnswerSettings } from "./AnswerSettings";
import { Loading, LoadingRow } from "./Loading";

const LOOP_PROMPTS = [
  "What is happening on this loop?",
  "Why did the agent send that email?",
  "What changed on the pages you watch?",
];

const WORKSPACE_PROMPTS = [
  "What have you done today?",
  "What is waiting on me?",
  "Which loops are stuck?",
];

/**
 * A read-only conversation about what Loomstate recorded. It answers from the
 * loop's own pages, watches, changes, email, approvals, and audit entries. It
 * takes no action: sending and approving stay on their own screens.
 */
export function Chat({
  loopId,
  title,
}: {
  loopId?: Id<"loops">;
  title: string;
}) {
  const history = useQuery(api.chat.history, { loopId });
  const ask = useAction(api.chat.ask);
  const clear = useMutation(api.chat.clear);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Dictation writes straight into the field, so a person can correct it by
  // hand before asking.
  const dictation = useDictation(setDraft);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [history, pending]);

  async function send(question: string) {
    const text = question.trim();
    if (text === "" || busy) return;
    if (dictation.listening) dictation.stop();
    setBusy(true);
    setError(null);
    setDraft("");
    setPending(text);
    try {
      await ask({ loopId, question: text });
    } catch (caught) {
      setError(readableError(caught, "Loomstate could not answer."));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const turns = history ?? [];
  const suggestions = loopId === undefined ? WORKSPACE_PROMPTS : LOOP_PROMPTS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-[11px] text-ink-400">
            Loomstate answers from its own records. It sends nothing from here.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <AnswerSettings />
          {turns.length > 0 ? (
            <button
              onClick={() => void clear({ loopId })}
              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {history === undefined ? (
          <Loading />
        ) : turns.length === 0 && pending === null ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-400">
              Ask about what Loomstate has been doing.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => void send(prompt)}
                  className="rounded-full border border-ink-800 px-2.5 py-1 text-[11px] text-ink-300 hover:border-thread/40 hover:text-thread"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn) => (
          <Turn key={turn._id} turn={turn} />
        ))}

        {pending !== null ? (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-br-sm border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-100">
                {pending}
              </div>
            </div>
            <LoadingRow label="Reading the records" />
          </>
        ) : null}

        {error !== null ? (
          <p className="rounded-lg border border-alarm/40 bg-alarm/5 px-3 py-2 text-xs text-alarm">
            {error}
          </p>
        ) : null}

        {dictation.error !== null ? (
          <p className="rounded-lg border border-warp/40 bg-warp/5 px-3 py-2 text-xs text-warp">
            {dictation.error}
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 gap-2 border-t border-ink-800 px-4 py-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={dictation.listening ? "Listening" : "Ask about this"}
          className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-ink-400/70 focus:border-thread/60"
        />

        {dictation.supported ? (
          <button
            type="button"
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            title={dictation.listening ? "Stop dictating" : "Dictate your question"}
            aria-label={dictation.listening ? "Stop dictating" : "Dictate your question"}
            aria-pressed={dictation.listening}
            className={`shrink-0 rounded-lg border px-2.5 py-2 transition-colors ${
              dictation.listening
                ? "border-alarm/60 bg-alarm/10 text-alarm"
                : "border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
            }`}
          >
            <MicIcon listening={dictation.listening} />
          </button>
        ) : null}
        <button
          type="submit"
          disabled={busy || draft.trim() === ""}
          className="shrink-0 rounded-lg bg-thread px-3.5 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Reading" : "Ask"}
        </button>
      </form>
    </div>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
        {...(listening ? { fill: "currentColor", fillOpacity: 0.25 } : {})}
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Turn({
  turn,
}: {
  turn: {
    _id: string;
    role: string;
    text: string;
    sources?: string[];
    at: number;
  };
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm border border-ink-700 bg-ink-800/60 px-3 py-2 text-sm text-ink-100">
          {turn.text}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[92%]">
      <div className="rounded-xl rounded-bl-sm border border-ink-800 bg-ink-950/60 px-3 py-2.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-200">
          {turn.text}
        </p>
      </div>
      <p className="mt-1 px-1 text-[10px] text-ink-400">
        {timeAgo(turn.at)}
        {turn.sources && turn.sources.length > 0
          ? ` · read ${turn.sources.join(", ")}`
          : ""}
      </p>
    </div>
  );
}
