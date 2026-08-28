import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
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
  ChatIcon,
} from "./components/Icons";
import IntentMap from "./routes/IntentMap";
import LoopDetail from "./routes/LoopDetail";
import Approvals from "./routes/Approvals";
import AuditLog from "./routes/AuditLog";
import Settings from "./routes/Settings";
import Signal from "./routes/Signal";
import SignIn from "./routes/SignIn";
import { LoopsSidebar } from "./components/LoopsSidebar";
import AskLoomstate from "./routes/AskLoomstate";
import Setup from "./routes/Setup";
import Privacy from "./routes/Privacy";
import { Loading } from "./components/Loading";

const nav = [
  { to: "/", label: "Intent map", icon: MapIcon, end: true },
  { to: "/ask", label: "Ask Loomstate", icon: ChatIcon, end: false },
  { to: "/signal", label: "Signal", icon: SignalIcon, end: false },
  { to: "/approvals", label: "Approvals", icon: InboxIcon, end: false },
  { to: "/audit", label: "Audit log", icon: LedgerIcon, end: false },
  { to: "/settings", label: "Settings", icon: GearIcon, end: false },
];

export default function App() {
  const location = useLocation();

  // Anyone may read the privacy policy, signed in or not. A policy you have to
  // hold an account to read is no use to the person deciding whether to make
  // one.
  if (location.pathname === "/privacy") {
    return (
      <div className="h-full overflow-y-auto">
        <Privacy />
      </div>
    );
  }

  return (
    <>
      <AuthLoading>
        <Loading />
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
  const setup = useQuery(api.setup.status);
  const location = useLocation();

  useEffect(() => {
    if (session !== undefined && session !== null && session.workspace === null) {
      void ensureWorkspace();
    }
  }, [session, ensureWorkspace]);

  if (session === undefined || session === null || session.workspace === null) {
    return <Loading label="Preparing your workspace" />;
  }

  // A new workspace goes to setup first. Nothing works without a key, so an
  // empty app would just sit there looking broken.
  if (
    setup !== undefined &&
    setup.showOnArrival &&
    location.pathname !== "/setup"
  ) {
    return <Navigate to="/setup" replace />;
  }

  if (location.pathname === "/setup") {
    return (
      <div className="h-full overflow-y-auto">
        <Setup />
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
          <Route path="/ask" element={<AskLoomstate />} />
          <Route path="/signal" element={<Signal />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/setup" element={<Setup />} />
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
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 px-3 py-5">
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

      <LoopsSidebar />

      <div className="mt-4 shrink-0 space-y-2 border-t border-ink-800 pt-3">
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
