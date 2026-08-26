import { useEffect } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import {
  GearIcon,
  InboxIcon,
  LedgerIcon,
  LoomMark,
  MapIcon,
  SignalIcon,
} from "./components/Icons";
import IntentMap from "./routes/IntentMap";
import LoopDetail from "./routes/LoopDetail";
import Approvals from "./routes/Approvals";
import AuditLog from "./routes/AuditLog";
import Settings from "./routes/Settings";
import Signal from "./routes/Signal";
import SignIn from "./routes/SignIn";

const nav = [
  { to: "/", label: "Intent map", icon: MapIcon, end: true },
  { to: "/signal", label: "Signal", icon: SignalIcon, end: false },
  { to: "/approvals", label: "Approvals", icon: InboxIcon, end: false },
  { to: "/audit", label: "Audit log", icon: LedgerIcon, end: false },
  { to: "/settings", label: "Settings", icon: GearIcon, end: false },
];

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="flex h-full items-center justify-center text-sm text-ink-400">
          Loading
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Workspace />
      </Authenticated>
    </>
  );
}

function Workspace() {
  const session = useQuery(api.workspaces.current);
  const ensureWorkspace = useMutation(api.workspaces.ensure);

  useEffect(() => {
    if (session !== undefined && session !== null && session.workspace === null) {
      void ensureWorkspace();
    }
  }, [session, ensureWorkspace]);

  if (session === undefined || session === null || session.workspace === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Preparing your workspace
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar email={session.user.email} workspaceName={session.workspace.name} />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<IntentMap />} />
          <Route path="/loops/:loopId" element={<LoopDetail />} />
          <Route path="/signal" element={<Signal />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar({
  email,
  workspaceName,
}: {
  email?: string;
  workspaceName: string;
}) {
  const { signOut } = useAuthActions();
  const pending = useQuery(api.approvals.pendingCount) ?? 0;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 px-3 py-5">
      <div className="mb-7 flex items-center gap-2.5 px-2">
        <LoomMark />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">Loomstate</p>
          <p className="truncate text-[11px] text-ink-400">{workspaceName}</p>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-ink-800 text-ink-100"
                  : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100",
              ].join(" ")
            }
          >
            <Icon />
            {label}
            {to === "/approvals" && pending > 0 ? (
              <span className="ml-auto rounded-full bg-alarm px-1.5 py-0.5 text-[10px] font-medium text-ink-950">
                {pending}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-2">
        <p className="truncate px-2 text-[11px] text-ink-400">{email ?? "Signed in"}</p>
        <button
          onClick={() => void signOut()}
          className="w-full rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
