import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Page } from "../components/Page";
import {
  Field,
  GhostButton,
  Note,
  PrimaryButton,
  ReadOnly,
  Section,
  TextInput,
  Toggle,
} from "../components/SettingsBits";
import { timeAgo, timeUntil } from "../lib/format";
import { readableError } from "../lib/errors";

const TIERS = [
  {
    id: "watch" as const,
    label: "Watch",
    help: "Loomstate monitors your loops and tells you. It sends nothing.",
  },
  {
    id: "draft" as const,
    label: "Draft",
    help: "Loomstate prepares each email. You approve every one before it goes.",
  },
  {
    id: "act" as const,
    label: "Act",
    help: "Loomstate sends its own questions. Money and one-way actions still wait for you.",
  },
];

export default function Settings() {
  const settings = useQuery(api.settings.overview);

  return (
    <Page
      title="Settings"
      lede="Who you are, how much the agent may do, where Loomstate reaches you, and the keys it uses."
    >
      {settings === undefined ? (
        <p className="text-sm text-ink-400">Loading</p>
      ) : (
        <div className="grid min-w-0 gap-4">
          <Profile data={settings.profile} />
          <Autonomy autonomy={settings.autonomy} caps={settings.caps} />
          <LoopAuthority
            loops={settings.loopOverrides}
            defaultTier={settings.autonomy.defaultTier}
          />
          <Notifications data={settings.notifications} />
          <Keys data={settings.keys} />
          <Pairing />
          <Exclusions />
        </div>
      )}
    </Page>
  );
}

// --- profile --------------------------------------------------------------

function Profile({
  data,
}: {
  data: {
    name?: string;
    email?: string;
    workspaceName: string;
    memberSince: number;
    agentAddresses: string[];
  };
}) {
  const save = useMutation(api.settings.saveProfile);
  const [name, setName] = useState(data.name ?? "");
  const [workspaceName, setWorkspaceName] = useState(data.workspaceName);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setName(data.name ?? "");
    setWorkspaceName(data.workspaceName);
  }, [data.name, data.workspaceName]);

  const changed =
    name !== (data.name ?? "") || workspaceName !== data.workspaceName;

  return (
    <Section
      title="Profile"
      lede="Your name and workspace. Loomstate signs you in with a passkey, so there is no password to change."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Your name">
          <TextInput value={name} onChange={setName} placeholder="Your name" />
        </Field>
        <Field label="Workspace">
          <TextInput value={workspaceName} onChange={setWorkspaceName} />
        </Field>
      </div>

      <Field label="Email" help="This comes from the passkey you signed in with.">
        <ReadOnly value={data.email ?? "not set"} />
      </Field>

      <Field
        label={
          data.agentAddresses.length === 1 ? "Agent address" : "Agent addresses"
        }
        help="Loomstate sends from this. It never sends from your own email."
      >
        {data.agentAddresses.length === 0 ? (
          <ReadOnly value="Loomstate creates one when an agent first acts." />
        ) : (
          <div className="space-y-1.5">
            {data.agentAddresses.map((address) => (
              <ReadOnly key={address} value={address} />
            ))}
          </div>
        )}
      </Field>

      <p className="mt-1 text-[11px] text-ink-400">
        Workspace created {timeAgo(data.memberSince)}.
      </p>

      <div className="mt-3">
        <PrimaryButton
          disabled={!changed}
          onClick={() => {
            void save({ name, workspaceName }).then(() =>
              setNote("Loomstate saved your profile."),
            );
          }}
        >
          Save profile
        </PrimaryButton>
      </div>
      <Note text={note} />
    </Section>
  );
}

// --- autonomy and caps ----------------------------------------------------

function Autonomy({
  autonomy,
  caps,
}: {
  autonomy: { defaultTier: "watch" | "draft" | "act"; autopilot: boolean };
  caps: {
    loopHourly: number;
    loopDaily: number;
    workspaceHourly: number;
    usingDefaults: boolean;
    limits: {
      loopHourly: { min: number; max: number };
      loopDaily: { min: number; max: number };
      workspaceHourly: { min: number; max: number };
    };
  };
}) {
  const setDefaults = useMutation(api.workspaces.setDefaults);
  const saveCaps = useMutation(api.settings.saveCaps);
  const resetCaps = useMutation(api.settings.resetCaps);

  const [loopHourly, setLoopHourly] = useState(String(caps.loopHourly));
  const [loopDaily, setLoopDaily] = useState(String(caps.loopDaily));
  const [workspaceHourly, setWorkspaceHourly] = useState(
    String(caps.workspaceHourly),
  );
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setLoopHourly(String(caps.loopHourly));
    setLoopDaily(String(caps.loopDaily));
    setWorkspaceHourly(String(caps.workspaceHourly));
  }, [caps.loopHourly, caps.loopDaily, caps.workspaceHourly]);

  return (
    <Section
      title="Agent autonomy"
      lede="How much the agent may do without asking. An action that commits money or cannot be undone always waits for your approval, whatever you pick here."
    >
      <div className="space-y-1.5">
        {TIERS.map((tier) => (
          <button
            key={tier.id}
            onClick={() => void setDefaults({ defaultTier: tier.id })}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              autonomy.defaultTier === tier.id
                ? "border-thread/50 bg-thread/5"
                : "border-ink-800 hover:border-ink-600"
            }`}
          >
            <p className="text-sm text-ink-100">{tier.label}</p>
            <p className="text-[11px] text-ink-400">{tier.help}</p>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <Toggle
          on={autonomy.autopilot}
          label={
            autonomy.autopilot
              ? "Loomstate builds loops and works them on a schedule."
              : "Loomstate is paused. It captures browsing but does no work."
          }
          help="Pausing stops every loop at once. Your browsing is still captured."
          onToggle={() => void setDefaults({ autopilot: !autonomy.autopilot })}
        />
      </div>

      <div className="mt-5 border-t border-ink-800 pt-4">
        <p className="text-sm font-medium">Send limits</p>
        <p className="mt-1 text-sm text-ink-400">
          A backstop on outbound email. Going over stops that loop and asks you to
          look at it. Loomstate holds the limit whether the agent sends by itself
          or you approve the send.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field
            label="One loop, per hour"
            help={`${caps.limits.loopHourly.min} to ${caps.limits.loopHourly.max}`}
          >
            <TextInput value={loopHourly} onChange={setLoopHourly} type="number" />
          </Field>
          <Field
            label="One loop, per day"
            help={`${caps.limits.loopDaily.min} to ${caps.limits.loopDaily.max}`}
          >
            <TextInput value={loopDaily} onChange={setLoopDaily} type="number" />
          </Field>
          <Field
            label="Workspace, per hour"
            help={`${caps.limits.workspaceHourly.min} to ${caps.limits.workspaceHourly.max}`}
          >
            <TextInput
              value={workspaceHourly}
              onChange={setWorkspaceHourly}
              type="number"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton
            onClick={() => {
              void saveCaps({
                loopHourly: Number(loopHourly),
                loopDaily: Number(loopDaily),
                workspaceHourly: Number(workspaceHourly),
              }).then((saved) =>
                setNote(
                  `Loomstate holds ${saved.loopHourly} an hour and ${saved.loopDaily} a day for one loop, and ${saved.workspaceHourly} an hour across the workspace.`,
                ),
              );
            }}
          >
            Save limits
          </PrimaryButton>
          {!caps.usingDefaults ? (
            <GhostButton
              onClick={() => {
                void resetCaps({}).then(() =>
                  setNote("Loomstate put the limits back to the built-in ones."),
                );
              }}
            >
              Use the built-in limits
            </GhostButton>
          ) : null}
        </div>
        <Note text={note} />
      </div>
    </Section>
  );
}

// --- per-loop overrides ---------------------------------------------------

function LoopAuthority({
  loops,
  defaultTier,
}: {
  loops: {
    _id: Id<"loops">;
    title: string;
    status: string;
    tier: "watch" | "draft" | "act";
    overridden: boolean;
    grantTier?: string;
    grantExpiresAt?: number;
    paused: boolean;
  }[];
  defaultTier: "watch" | "draft" | "act";
}) {
  const setTier = useMutation(api.loops.setTier);

  return (
    <Section
      title="Authority on one loop"
      lede={`Every loop follows your ${defaultTier} setting unless you change it here. A loop set apart keeps its own level until you put it back.`}
    >
      {loops.length === 0 ? (
        <p className="text-sm text-ink-400">You have no open loops yet.</p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800">
          {loops.map((loop) => (
            <li key={loop._id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/loops/${loop._id}`}
                  className="min-w-0 flex-1 truncate text-sm text-ink-200 hover:text-thread"
                >
                  {loop.title}
                </Link>
                {loop.paused ? (
                  <span className="shrink-0 rounded-full border border-alarm/50 px-2 py-0.5 text-[10px] text-alarm">
                    stopped
                  </span>
                ) : null}
                {loop.overridden ? (
                  <span className="shrink-0 rounded-full border border-warp/40 px-2 py-0.5 text-[10px] text-warp">
                    set apart
                  </span>
                ) : null}

                <div className="flex shrink-0 gap-1">
                  {TIERS.map((tier) => (
                    <button
                      key={tier.id}
                      onClick={() =>
                        void setTier({ loopId: loop._id, tier: tier.id })
                      }
                      title={tier.help}
                      className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                        loop.tier === tier.id
                          ? "border-thread/50 bg-thread/10 text-thread"
                          : "border-ink-800 text-ink-400 hover:border-ink-600 hover:text-ink-200"
                      }`}
                    >
                      {tier.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-1 text-[11px] text-ink-400">
                {loop.grantTier === undefined
                  ? "No authority is live. Loomstate applies your setting on the next run."
                  : `Holding ${loop.grantTier} authority, which renews ${timeUntil(loop.grantExpiresAt ?? 0)}.`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// --- notifications --------------------------------------------------------

function Notifications({
  data,
}: {
  data: { email: boolean; browser: boolean; inboundConnected: boolean };
}) {
  const save = useMutation(api.settings.saveNotifications);
  const connect = useAction(api.email.connectReplies);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const silent = !data.email && !data.browser;

  return (
    <Section
      title="How Loomstate reaches you"
      lede="Loomstate works while the app is shut, so it tells you when an action needs your decision. Choose where."
    >
      <div className="space-y-2">
        <Toggle
          on={data.email}
          label="Email"
          help="The agent writes to you from its own inbox with the action and a link."
          onToggle={() => void save({ email: !data.email })}
        />
        <Toggle
          on={data.browser}
          label="Browser"
          help="The extension raises a notification you can answer without opening Loomstate."
          onToggle={() => void save({ browser: !data.browser })}
        />
      </div>

      {silent ? (
        <p className="mt-3 rounded-lg border border-warp/40 bg-warp/5 px-3 py-2 text-xs text-ink-200">
          Every channel is off. An action still waits in the approval queue, but
          Loomstate does not announce it, so you have to come and look.
        </p>
      ) : null}

      <div className="mt-4 border-t border-ink-800 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              data.inboundConnected ? "bg-thread" : "bg-warp"
            }`}
          />
          <span className="min-w-0 flex-1 text-sm text-ink-300">
            {data.inboundConnected
              ? "AgentMail posts every reply to Loomstate."
              : "Replies do not reach Loomstate yet."}
          </span>
          <GhostButton
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setNote(null);
              connect({})
                .then((r) => setNote(r.detail))
                .catch((e) =>
                  setNote(readableError(e, "Loomstate could not connect replies.")),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy
              ? "Connecting"
              : data.inboundConnected
                ? "Reconnect"
                : "Connect replies"}
          </GhostButton>
        </div>
        <Note text={note} />
      </div>
    </Section>
  );
}

// --- keys and models ------------------------------------------------------

function Keys({
  data,
}: {
  data: {
    model: string;
    effort: string;
    stored: { provider: string; hint: string; updatedAt: number }[];
  };
}) {
  const save = useAction(api.secrets.save);
  const forget = useMutation(api.secrets.forget);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const openai = data.stored.find((s) => s.provider === "openai");

  return (
    <Section
      title="Keys and models"
      lede="Loomstate uses your own OpenAI key to rebuild loops, judge risk, draft email, and answer in the chat. The key is encrypted on the server and never reaches the extension."
    >
      {openai !== undefined ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-ink-800 px-3 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-thread" />
          <span className="flex-1 font-mono text-xs text-ink-300">
            {openai.hint}
          </span>
          <span className="text-xs text-ink-400">
            saved {timeAgo(openai.updatedAt)}
          </span>
          <GhostButton danger onClick={() => void forget({ provider: "openai" })}>
            Remove
          </GhostButton>
        </div>
      ) : null}

      <Field label={openai === undefined ? "Your OpenAI key" : "Replace the key"}>
        <div className="flex gap-2">
          <TextInput
            type="password"
            value={key}
            onChange={setKey}
            placeholder="sk-..."
            className="font-mono"
          />
          <GhostButton
            disabled={busy || key.trim() === ""}
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
          >
            {busy ? "Checking" : "Save key"}
          </GhostButton>
        </div>
      </Field>

      <div className="mt-4 border-t border-ink-800 pt-4">
        <p className="text-sm font-medium">Chat model</p>
        <p className="mt-1 text-sm text-ink-400">
          The chat answers with {data.model}, thinking at {data.effort} effort
          where the model takes one. Change it from the model button in any chat,
          where Loomstate lists what your key reaches.
        </p>
        <Link
          to="/ask"
          className="mt-2 inline-block text-xs text-ink-400 hover:text-thread"
        >
          Open the chat
        </Link>
      </div>

      <Note text={note} />
    </Section>
  );
}

// --- pairing and exclusions -----------------------------------------------

const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL;

function Pairing() {
  const devices = useQuery(api.devices.list);
  const pair = useAction(api.devices.pair);
  const revoke = useMutation(api.devices.revoke);
  const [label, setLabel] = useState("This browser");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = (devices ?? []).filter((d) => d.revokedAt === undefined);

  return (
    <Section
      title="Paired browsers"
      lede="The extension needs one token. Loomstate shows it once and stores only its hash."
    >
      <div className="flex gap-2">
        <TextInput value={label} onChange={setLabel} placeholder="Name this browser" />
        <PrimaryButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            pair({ label })
              .then((r) => setToken(r.token))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Creating" : "Create token"}
        </PrimaryButton>
      </div>

      {token !== null ? (
        <div className="mt-3 rounded-lg border border-thread/30 bg-thread/5 p-4">
          <p className="text-xs text-ink-300">
            Open the Loomstate extension. Paste both values, then select "Pair this
            browser".
          </p>
          <Copyable label="Loomstate address" value={SITE_URL} />
          <Copyable label="Pairing token" value={token} />
          <p className="mt-3 text-[11px] text-warp">
            Copy the token now. Loomstate cannot show it again.
          </p>
        </div>
      ) : null}

      {live.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink-800 rounded-lg border border-ink-800">
          {live.map((device) => (
            <li key={device._id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  device.lastSeenAt ? "bg-thread" : "bg-warp"
                }`}
              />
              <span className="flex-1 text-sm">{device.label}</span>
              <span className="text-xs text-ink-400">
                {device.lastSeenAt
                  ? `seen ${timeAgo(device.lastSeenAt)}`
                  : "waiting for the first event"}
              </span>
              <button
                onClick={() => void revoke({ deviceId: device._id })}
                className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
              >
                Stop
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-400">No browser is paired.</p>
      )}
    </Section>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
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
    <Section
      title="Excluded domains"
      lede="The extension blocks banking and health domains inside the browser. A page on this list never leaves your machine, even if you add it by hand."
    >
      <div className="flex gap-2">
        <TextInput
          value={draft}
          onChange={setDraft}
          placeholder="example.com or *.example.com"
        />
        <GhostButton
          disabled={draft.trim() === ""}
          onClick={() => {
            void add({ pattern: draft }).then(() => setDraft(""));
          }}
        >
          Add
        </GhostButton>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
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
    </Section>
  );
}
