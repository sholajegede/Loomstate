import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, Page } from "../components/Page";
import { timeAgo } from "../lib/format";

const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL;

export default function Settings() {
  return (
    <Page
      title="Settings"
      lede="Pair a browser, choose the domains Loomstate must never read, and set your own API key."
    >
      <div className="grid gap-4">
        <Pairing />
        <Exclusions />
        <Keys />
      </div>
    </Page>
  );
}

function Pairing() {
  const devices = useQuery(api.devices.list);
  const pair = useAction(api.devices.pair);
  const revoke = useMutation(api.devices.revoke);
  const [label, setLabel] = useState("This browser");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPair() {
    setBusy(true);
    try {
      const result = await pair({ label });
      setToken(result.token);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-medium">Browser pairing</h2>
      <p className="mt-1 text-sm text-ink-400">
        The extension needs one token. Loomstate shows the token once and stores only
        its hash.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name this browser"
          className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-thread/60"
        />
        <button
          onClick={() => void onPair()}
          disabled={busy}
          className="rounded-lg bg-thread px-3.5 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating" : "Create token"}
        </button>
      </div>

      {token !== null ? (
        <div className="mt-4 rounded-lg border border-thread/30 bg-thread/5 p-4">
          <p className="text-xs text-ink-300">
            Open the Loomstate extension popup. Paste both values, then select "Pair
            this browser".
          </p>
          <Field label="Loomstate address" value={SITE_URL} />
          <Field label="Pairing token" value={token} />
          <p className="mt-3 text-[11px] text-warp">
            Copy the token now. Loomstate cannot show it again.
          </p>
        </div>
      ) : null}

      {devices && devices.length > 0 ? (
        <ul className="mt-4 divide-y divide-ink-800 rounded-lg border border-ink-800">
          {devices.map((device) => (
            <li key={device._id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  device.revokedAt !== undefined
                    ? "bg-ink-600"
                    : device.lastSeenAt
                      ? "bg-thread"
                      : "bg-warp"
                }`}
              />
              <span className="flex-1 text-sm">{device.label}</span>
              <span className="text-xs text-ink-400">
                {device.revokedAt !== undefined
                  ? "stopped"
                  : device.lastSeenAt
                    ? `seen ${timeAgo(device.lastSeenAt)}`
                    : "waiting for the first event"}
              </span>
              {device.revokedAt === undefined ? (
                <button
                  onClick={() => void revoke({ deviceId: device._id })}
                  className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
                >
                  Stop
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
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

function Exclusions() {
  const patterns = useQuery(api.blocklist.list);
  const add = useMutation(api.blocklist.add);
  const remove = useMutation(api.blocklist.remove);
  const [draft, setDraft] = useState("");

  return (
    <Card>
      <h2 className="text-sm font-medium">Excluded domains</h2>
      <p className="mt-1 text-sm text-ink-400">
        The extension blocks banking and health domains inside the browser. Pages on
        this list never leave your machine.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="example.com or *.example.com"
          className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-thread/60"
        />
        <button
          onClick={() => {
            void add({ pattern: draft }).then(() => setDraft(""));
          }}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm hover:bg-ink-800"
        >
          Add
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(patterns ?? []).map((p) => (
          <button
            key={p._id}
            onClick={() => void remove({ id: p._id })}
            title="Remove"
            className="rounded-full border border-ink-700 px-2.5 py-1 font-mono text-[11px] text-ink-300 hover:border-alarm/50 hover:text-alarm"
          >
            {p.pattern}
          </button>
        ))}
      </div>
    </Card>
  );
}

function Keys() {
  const stored = useQuery(api.secrets.status);
  const save = useAction(api.secrets.save);
  const forget = useMutation(api.secrets.forget);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const openai = (stored ?? []).find((s) => s.provider === "openai");

  async function onSave() {
    setBusy(true);
    setNote(null);
    try {
      const result = await save({ provider: "openai", key });
      setNote(result.detail);
      if (result.ok) setKey("");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Loomstate could not save the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-medium">Your OpenAI key</h2>
      <p className="mt-1 text-sm text-ink-400">
        Loomstate uses your own key to rebuild loops, judge risk, and draft email. The
        key is encrypted on the server and never reaches the extension.
      </p>

      {openai !== undefined ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-ink-800 px-3 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-thread" />
          <span className="flex-1 font-mono text-xs text-ink-300">{openai.hint}</span>
          <span className="text-xs text-ink-400">saved {timeAgo(openai.updatedAt)}</span>
          <button
            onClick={() => void forget({ provider: "openai" })}
            className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
          >
            Remove
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-..."
          className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-sm outline-none focus:border-thread/60"
        />
        <button
          onClick={() => void onSave()}
          disabled={busy || key.trim() === ""}
          className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm hover:bg-ink-800 disabled:opacity-50"
        >
          {busy ? "Checking" : "Save key"}
        </button>
      </div>

      {note !== null ? <p className="mt-2 text-xs text-ink-400">{note}</p> : null}
    </Card>
  );
}
