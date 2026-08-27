import type { ReactNode } from "react";

/** One settings section: a heading, a sentence of context, and its controls. */
export function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-ink-800 bg-ink-900/60 p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-400">{lede}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A labelled row inside a section. */
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="block text-[11px] text-ink-400">{label}</label>
      <div className="mt-1">{children}</div>
      {help ? <p className="mt-1 text-[11px] text-ink-400">{help}</p> : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-ink-400/70 focus:border-thread/60 ${className}`}
    />
  );
}

/** A read-only value the person cannot change here. */
export function ReadOnly({ value, hint }: { value: string; hint?: string }) {
  return (
    <div>
      <p className="truncate rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 font-mono text-xs text-ink-300">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-ink-400">{hint}</p> : null}
    </div>
  );
}

/** An on and off control with its own explanation. */
export function Toggle({
  on,
  label,
  help,
  onToggle,
}: {
  on: boolean;
  label: string;
  help: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-ink-800 px-3 py-2.5">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          on ? "bg-thread" : "bg-ink-600"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-100">{label}</p>
        <p className="text-[11px] leading-relaxed text-ink-400">{help}</p>
      </div>
      <button
        onClick={onToggle}
        className="shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800"
      >
        {on ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-thread px-3.5 py-2 text-sm font-medium text-ink-950 hover:opacity-90 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-ink-700 px-3.5 py-2 text-sm disabled:opacity-40 ${
        danger
          ? "text-ink-300 hover:border-alarm/50 hover:text-alarm"
          : "hover:bg-ink-800"
      }`}
    >
      {children}
    </button>
  );
}

export function Note({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p className="mt-3 rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 text-xs text-ink-300">
      {text}
    </p>
  );
}
