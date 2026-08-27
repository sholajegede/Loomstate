import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { LoomMark } from "../components/Icons";
import { readableError } from "../lib/errors";
import { Loading } from "../components/Loading";

const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL;

const TIERS = [
  {
    id: "watch" as const,
    label: "Watch",
    help: "Loomstate tells you what changed. It sends nothing.",
  },
  {
    id: "draft" as const,
    label: "Draft",
    help: "Loomstate writes each email. You approve every one before it goes.",
    recommended: true,
  },
  {
    id: "act" as const,
    label: "Act",
    help: "Loomstate sends its own questions. Money still waits for you.",
  },
];

/**
 * The three things Loomstate needs before it can do anything.
 *
 * Each step shows what is actually true rather than what has been clicked, so
 * an owner who leaves halfway and comes back sees exactly what is still
 * missing. Every step can be left for later.
 */
export default function Setup() {
  const status = useQuery(api.setup.status);
  const complete = useMutation(api.setup.complete);
  const skip = useMutation(api.setup.skip);
  const navigate = useNavigate();

  if (status === undefined) {
    return <Loading />;
  }

  const done = status.hasKey && status.pairedBrowsers > 0;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8 flex items-center gap-3">
        <LoomMark className="h-9 w-9" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Set Loomstate up
          </h1>
          <p className="text-sm text-ink-400">
            Three things, and Loomstate starts working on its own.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <KeyStep hasKey={status.hasKey} />
        <BrowserStep
          paired={status.pairedBrowsers}
          reporting={status.browserReporting}
        />
        <TierStep current={status.defaultTier} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            void complete({}).then(() => navigate("/"));
          }}
          disabled={!status.hasKey}
          className="rounded-lg bg-thread px-4 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-40"
        >
          {done ? "Start using Loomstate" : "Finish setup"}
        </button>

        {status.doneAt === undefined ? (
          <button
            onClick={() => {
              void skip({}).then(() => navigate("/"));
            }}
            className="text-sm text-ink-400 hover:text-ink-100"
          >
            I will do this later
          </button>
        ) : (
          <button
            onClick={() => navigate("/")}
            className="text-sm text-ink-400 hover:text-ink-100"
          >
            Back to Loomstate
          </button>
        )}
      </div>

      {!status.hasKey ? (
        <p className="mt-3 text-[11px] text-ink-400">
          Loomstate needs the key before it can build a loop. You can add the
          browser and the tier at any time.
        </p>
      ) : null}
    </div>
  );
}

function Step({
  index,
  title,
  lede,
  done,
  doneLabel,
  children,
}: {
  index: number;
  title: string;
  lede: string;
  done: boolean;
  doneLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border p-5 transition-colors ${
        done ? "border-thread/40 bg-thread/5" : "border-ink-800 bg-ink-900/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
            done
              ? "bg-thread text-ink-950"
              : "border border-ink-700 text-ink-400"
          }`}
        >
          {done ? "✓" : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{title}</h2>
            {done ? (
              <span className="text-[11px] text-thread">{doneLabel}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-400">{lede}</p>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function KeyStep({ hasKey }: { hasKey: boolean }) {
  const save = useAction(api.secrets.save);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <Step
      index={1}
      title="Add your OpenAI key"
      lede="Loomstate uses your own key to rebuild your loops, judge how risky an action is, draft email, and answer in the chat. Nothing works without it."
      done={hasKey}
      doneLabel="saved"
    >
      {hasKey ? (
        <p className="text-sm text-ink-300">
          Loomstate holds your key. You can replace it in settings whenever you
          want.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-sm outline-none focus:border-thread/60"
            />
            <button
              onClick={() => {
                setBusy(true);
                setNote(null);
                save({ provider: "openai", key })
                  .then((r) => {
                    setNote(r.detail);
                    if (r.ok) setKey("");
                  })
                  .catch((e) =>
                    setNote(readableError(e, "Loomstate could not save the key.")),
                  )
                  .finally(() => setBusy(false));
              }}
              disabled={busy || key.trim() === ""}
              className="shrink-0 rounded-lg bg-thread px-3.5 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Checking" : "Save key"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            Loomstate checks the key against OpenAI, then encrypts it on the
            server. It is never sent to the extension and never leaves your
            workspace. Create one at platform.openai.com.
          </p>
          {note !== null ? (
            <p className="mt-2 text-xs text-ink-300">{note}</p>
          ) : null}
        </>
      )}
    </Step>
  );
}

function BrowserStep({
  paired,
  reporting,
}: {
  paired: number;
  reporting: boolean;
}) {
  const pair = useAction(api.devices.pair);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Step
      index={2}
      title="Connect your browser"
      lede="A small extension tells Loomstate which pages you read, so it can work out what you are part way through. It blocks banking and health pages before anything leaves your machine."
      done={paired > 0}
      doneLabel={reporting ? "paired and reporting" : "paired"}
    >
      {paired > 0 ? (
        <p className="text-sm text-ink-300">
          {reporting
            ? "Your browser is sending pages to Loomstate."
            : "Your browser is paired. It reports the first page you read for more than a few seconds."}
        </p>
      ) : (
        <>
          <ol className="space-y-1.5 text-sm text-ink-300">
            <li>1. Open chrome://extensions and turn on Developer mode.</li>
            <li>
              2. Select Load unpacked, then choose the extension folder from the
              Loomstate repository.
            </li>
            <li>3. Create a token below and paste both values into the popup.</li>
          </ol>

          <button
            onClick={() => {
              setBusy(true);
              pair({ label: "This browser" })
                .then((r) => setToken(r.token))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            className="mt-3 rounded-lg border border-ink-700 px-3.5 py-2 text-sm hover:bg-ink-800 disabled:opacity-40"
          >
            {busy ? "Creating" : "Create a pairing token"}
          </button>

          {token !== null ? (
            <div className="mt-3 rounded-lg border border-thread/30 bg-thread/5 p-3">
              <Copyable label="Loomstate address" value={SITE_URL} />
              <Copyable label="Pairing token" value={token} />
              <p className="mt-2 text-[11px] text-warp">
                Copy the token now. Loomstate cannot show it again.
              </p>
              <p className="mt-2 text-[11px] text-ink-400">
                This step ticks itself the moment the extension pairs.
              </p>
            </div>
          ) : null}
        </>
      )}
    </Step>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-[11px] text-ink-400">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-ink-700 bg-ink-950 px-2 py-1.5 font-mono text-xs text-ink-100">
          {value}
        </code>
        <button
          onClick={() => void navigator.clipboard.writeText(value)}
          className="rounded border border-ink-700 px-2 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function TierStep({ current }: { current: string }) {
  const setDefaults = useMutation(api.workspaces.setDefaults);

  return (
    <Step
      index={3}
      title="Choose how much the agent may do"
      lede="You set this once and every loop follows it. An action that commits money or cannot be undone always waits for you, whatever you pick."
      done
      doneLabel={`set to ${current}`}
    >
      <div className="space-y-1.5">
        {TIERS.map((tier) => (
          <button
            key={tier.id}
            onClick={() => void setDefaults({ defaultTier: tier.id })}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              current === tier.id
                ? "border-thread/50 bg-thread/10"
                : "border-ink-800 hover:border-ink-600"
            }`}
          >
            <div className="flex items-center gap-2">
              <p className="text-sm text-ink-100">{tier.label}</p>
              {tier.recommended ? (
                <span className="rounded-full border border-thread/40 px-2 py-0.5 text-[10px] text-thread">
                  recommended
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-ink-400">{tier.help}</p>
          </button>
        ))}
      </div>
    </Step>
  );
}
