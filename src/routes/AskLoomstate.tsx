import { Chat } from "../components/Chat";

/** The workspace chat: everything the agent has been doing, across loops. */
export default function AskLoomstate() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-6">
      <div className="mb-3 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Ask Loomstate</h1>
        <p className="mt-1 text-sm text-ink-400">
          Ask what the agents have done, what changed, and what waits on you.
          Loomstate answers from its own records.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900/60">
        <Chat title="Every loop" />
      </div>
    </div>
  );
}
