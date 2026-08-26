import type { ReactNode } from "react";

export function Page({
  title,
  lede,
  actions,
  children,
}: {
  title: string;
  lede: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto min-w-0 max-w-6xl px-8 py-9">
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-400">{lede}</p>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  hint,
}: {
  title: string;
  body: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 px-8 py-14 text-center">
      <p className="text-sm font-medium text-ink-200">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">{body}</p>
      {hint ? <p className="mt-3 text-xs text-ink-400/80">{hint}</p> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-ink-800 bg-ink-900/60 p-5 ${className}`}
    >
      {children}
    </div>
  );
}
