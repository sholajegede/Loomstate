import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { readableError } from "../lib/errors";

const EFFORTS = [
  { id: "low" as const, label: "Low", help: "Answers fastest." },
  { id: "medium" as const, label: "Medium", help: "Thinks a little longer." },
  { id: "high" as const, label: "High", help: "Thinks hardest. Slowest." },
];

/**
 * Chooses the model the chat answers with, and how hard it thinks.
 *
 * The list is fetched from the owner's own key, so it shows what that key can
 * reach. The effort control appears only for a model whose family takes one;
 * for every other model there is no such setting and none is shown.
 */
export function AnswerSettings() {
  const preference = useQuery(api.models.chatPreference);
  const setPreference = useMutation(api.models.setChatPreference);
  const listModels = useAction(api.models.available);

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<
    { id: string; supportsEffort: boolean }[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  // Fetch once, the first time the panel opens. The list rarely changes and
  // the call costs the owner a request against their key.
  useEffect(() => {
    if (!open || models !== null || loading) return;
    setLoading(true);
    setError(null);
    listModels({})
      .then((result) => setModels(result.models))
      .catch((caught) =>
        setError(readableError(caught, "Loomstate could not list your models.")),
      )
      .finally(() => setLoading(false));
  }, [open, models, loading, listModels]);

  useEffect(() => {
    if (!open) return;
    function onClickAway(event: MouseEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  if (preference === undefined) return null;

  return (
    <div className="relative" ref={panel}>
      <button
        onClick={() => setOpen((was) => !was)}
        title="Choose the model that answers"
        className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
      >
        {preference.model}
        {preference.supportsEffort ? ` · ${preference.effort}` : ""}
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-20 w-64 rounded-xl border border-ink-700 bg-ink-950 p-3 shadow-xl">
          <p className="text-[11px] uppercase tracking-wide text-ink-400">
            Model
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
            These are the chat models your own key reaches.
          </p>

          <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
            {loading ? (
              <p className="px-1 py-2 text-[11px] text-ink-400">
                Asking OpenAI what your key reaches
              </p>
            ) : error !== null ? (
              <p className="px-1 py-2 text-[11px] text-alarm">{error}</p>
            ) : (
              (models ?? []).map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    void setPreference({ model: model.id });
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    preference.model === model.id
                      ? "bg-thread/10 text-thread"
                      : "text-ink-300 hover:bg-ink-800"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {model.id}
                  </span>
                  {model.supportsEffort ? (
                    <span
                      title="This model takes an effort setting"
                      className="shrink-0 text-[9px] uppercase tracking-wide text-ink-400"
                    >
                      effort
                    </span>
                  ) : null}
                </button>
              ))
            )}

            {!loading && error === null && (models ?? []).length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-ink-400">
                Your key reaches no chat model.
              </p>
            ) : null}
          </div>

          {preference.supportsEffort ? (
            <>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-ink-400">
                Effort
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
                {preference.model} thinks before it answers. More effort costs
                more and takes longer.
              </p>
              <div className="mt-2 space-y-0.5">
                {EFFORTS.map((level) => (
                  <button
                    key={level.id}
                    onClick={() => void setPreference({ effort: level.id })}
                    className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                      preference.effort === level.id
                        ? "bg-thread/10 text-thread"
                        : "text-ink-300 hover:bg-ink-800"
                    }`}
                  >
                    <span className="text-[11px]">{level.label}</span>
                    <span className="ml-1.5 text-[10px] text-ink-400">
                      {level.help}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-[10px] leading-relaxed text-ink-400">
              {preference.model} has no effort setting, so Loomstate sends none.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
