import { NavLink, Route, Routes } from "react-router-dom";
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

const nav = [
  { to: "/", label: "Intent map", icon: MapIcon, end: true },
  { to: "/signal", label: "Signal", icon: SignalIcon, end: false },
  { to: "/approvals", label: "Approvals", icon: InboxIcon, end: false },
  { to: "/audit", label: "Audit log", icon: LedgerIcon, end: false },
  { to: "/settings", label: "Settings", icon: GearIcon, end: false },
];

export default function App() {
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900/60 px-3 py-5">
        <div className="mb-7 flex items-center gap-2.5 px-2">
          <LoomMark />
          <div>
            <p className="text-sm font-semibold tracking-tight">Loomstate</p>
            <p className="text-[11px] text-ink-400">Your open loops, kept alive</p>
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
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-lg border border-ink-800 bg-ink-900 p-3">
          <p className="text-[11px] leading-relaxed text-ink-400">
            Loomstate reads your browsing signal, rebuilds the goals behind it, and
            works them under limits you set.
          </p>
        </div>
      </aside>

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
