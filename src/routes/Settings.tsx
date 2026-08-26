import { Card, Page } from "../components/Page";

export default function Settings() {
  return (
    <Page
      title="Settings"
      lede="Pair a browser, set your own API keys, and choose the domains Loomstate must never read."
    >
      <div className="grid gap-4">
        <Card>
          <h2 className="text-sm font-medium">Browser pairing</h2>
          <p className="mt-1 text-sm text-ink-400">
            Pairing is not available yet in this build.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium">Your API keys</h2>
          <p className="mt-1 text-sm text-ink-400">
            Loomstate uses your own OpenAI key. The key is encrypted on the server.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium">Excluded domains</h2>
          <p className="mt-1 text-sm text-ink-400">
            The extension blocks banking and health domains before any data leaves your
            browser. You can add more.
          </p>
        </Card>
      </div>
    </Page>
  );
}
