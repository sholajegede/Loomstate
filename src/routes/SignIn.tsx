import { useEffect, useState, type FormEvent } from "react";
import { usePasskeyAuth } from "@convex-dev/auth/react";
import { LoomMark } from "../components/Icons";

export default function SignIn() {
  const { signInOrRegisterWithPasskey, startConditionalPasskeySignIn } =
    usePasskeyAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void startConditionalPasskeySignIn().catch(() => {
      // Autofill is unavailable in this browser. The form still works.
    });
  }, [startConditionalPasskeySignIn]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (email.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await signInOrRegisterWithPasskey({ email: email.trim() });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The browser could not complete the passkey step.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <LoomMark className="h-9 w-9" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Loomstate</h1>
            <p className="text-sm text-ink-400">Your open loops, kept alive</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm text-ink-300" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm outline-none placeholder:text-ink-400/70 focus:border-thread/60"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-thread px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Waiting for your passkey" : "Continue with a passkey"}
          </button>
        </form>

        {error ? (
          <p className="mt-3 text-sm text-alarm">{error}</p>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            Loomstate uses a passkey. Your device creates one on your first visit
            and signs you in after that.
          </p>
        )}
      </div>
    </div>
  );
}
