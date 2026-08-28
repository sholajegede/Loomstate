import { Link } from "react-router-dom";
import { LoomMark } from "../components/Icons";

/**
 * The privacy policy.
 *
 * It describes what the product actually does, checked against the code, and
 * not what a policy template says a product like this usually does. It is a
 * static page so that anyone can read it, signed in or not.
 */
export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link to="/" className="mb-8 flex items-center gap-3">
        <LoomMark className="h-8 w-8" />
        <span className="text-sm font-semibold tracking-tight">Loomstate</span>
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-2 text-sm text-ink-400">Last updated 28 August 2026.</p>

      <div className="mt-8 space-y-8">
        <Section title="What Loomstate is for">
          <P>
            Loomstate rebuilds the goals you started on the web and never
            finished, watches the pages behind them, and works them for you
            inside limits you set. To do that it needs to know which pages you
            read. This page says exactly what it collects, where that goes, and
            how to remove it.
          </P>
        </Section>

        <Section title="What the extension collects">
          <P>
            The Loomstate browser extension reports a page only after you have
            read it for more than four seconds. For each page it sends three
            things:
          </P>
          <List
            items={[
              "The address of the page, including a search term when the address carries one.",
              "The title of the page.",
              "When you opened it and how long you stayed.",
            ]}
          />
          <P>
            It does not read the content of the page, your form entries, your
            passwords, or your cookies. It does not record what you type. It
            does not track you across sites for advertising, and Loomstate sells
            nothing to anybody.
          </P>
          <P>
            Before anything is queued, the extension checks the page against a
            list of banking, payment, and health domains held inside the
            extension. A page on that list never leaves your machine. The server
            checks your workspace list again before it stores anything, so the
            rule holds even if the extension is out of date. You can add your own
            domains to that list in settings.
          </P>
        </Section>

        <Section title="What Loomstate does with it">
          <P>
            Your browsing is used for one purpose: to work out which goals you
            are part way through, and to work those goals for you. Loomstate
            groups pages that serve the same goal into a loop, names it, watches
            the pages that matter, and proposes the next step.
          </P>
          <P>
            It is not used for anything else. It is not profiled, sold, shared
            with advertisers, or used to train anybody's model.
          </P>
        </Section>

        <Section title="Who else sees your data">
          <P>
            Loomstate uses three outside services. Each one receives only what it
            needs, and only when Loomstate is doing the work you asked for.
          </P>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left">
                  <Th>Service</Th>
                  <Th>Receives</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                <Row
                  service="OpenAI"
                  receives="Page addresses and titles from the loops being rebuilt, the text of a watched page being read, and the email on a loop."
                  when="When Loomstate rebuilds loops, reads a watched page, decides an action, or answers your question in the chat. It runs on your own key."
                />
                <Row
                  service="Firecrawl"
                  receives="The address of a page you have under watch."
                  when="Every time Loomstate re-reads that page to see what changed."
                />
                <Row
                  service="AgentMail"
                  receives="The email the agent sends, and the replies it receives."
                  when="When an agent sends a message on a loop, or a reply comes back."
                />
              </tbody>
            </table>
          </div>

          <P>
            Everything else stays in your own Convex deployment. Loomstate has no
            analytics, no advertising network, and no third-party tracking.
          </P>
        </Section>

        <Section title="Your OpenAI key">
          <P>
            You bring your own OpenAI key, so the reasoning runs on your account
            rather than someone else's. Loomstate checks the key against OpenAI,
            then encrypts it with AES-GCM under a key held only in the server
            environment. The encrypted key is never returned to a browser, never
            sent to the extension, and never shared with anyone. The app shows
            only the last four characters, so you can tell which key is stored.
          </P>
          <P>You can remove the key at any time in settings.</P>
        </Section>

        <Section title="How you sign in">
          <P>
            Loomstate uses passkeys. Your device holds the key and proves who you
            are with your fingerprint, face, or device passcode. There is no
            password, so there is no password for anybody to lose or leak.
          </P>
          <P>
            The extension does not use your passkey. It holds a pairing token
            instead, and Loomstate stores only a hash of that token, so it cannot
            be read back out of the database. A pairing token is deliberately
            weaker than a passkey: it can never approve an action that commits
            money or cannot be undone. You can stop a paired browser at any time
            in settings, and it is refused from the next request onward.
          </P>
        </Section>

        <Section title="How long Loomstate keeps things">
          <P>
            Loomstate keeps your loops, browsing signal, watches, email, and
            audit log until you remove them. It does not expire them on its own,
            because a goal you left last month is exactly the thing the product
            exists to hold.
          </P>
        </Section>

        <Section title="How to delete your data">
          <P>You can remove any of it yourself, from inside the app.</P>
          <List
            items={[
              "Remove one loop and everything it holds. The loop page has a control that deletes its email, approvals, grants, agent runs, watches, page snapshots, detected changes, and audit entries.",
              "Remove your OpenAI key. Settings deletes the stored key.",
              "Stop a paired browser. Settings revokes the token, and that browser stops reporting at once.",
              "Clear a chat. Each conversation has a control that deletes its turns.",
              "Pause everything. Settings stops the agent across the workspace while keeping your data.",
            ]}
          />
          <P>
            To delete a whole workspace and everything in it, write to the
            address below and say so. Loomstate removes it and confirms when the
            removal is done.
          </P>
        </Section>

        <Section title="Changes to this policy">
          <P>
            If this policy changes, the date at the top changes with it. The
            history of this page is public in the Loomstate repository, so you
            can see exactly what changed and when.
          </P>
        </Section>

        <Section title="Contact">
          <P>
            Write to{" "}
            <a
              href="mailto:jegedeshola@gmail.com"
              className="text-thread hover:underline"
            >
              jegedeshola@gmail.com
            </a>{" "}
            with any question about this policy, or to ask for your data to be
            removed.
          </P>
        </Section>
      </div>

      <Link
        to="/"
        className="mt-10 inline-block text-sm text-ink-400 hover:text-ink-100"
      >
        Back to Loomstate
      </Link>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-ink-100">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-300">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-relaxed text-ink-300">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-2 pr-4 text-[11px] font-medium uppercase tracking-wide text-ink-400">
      {children}
    </th>
  );
}

function Row({
  service,
  receives,
  when,
}: {
  service: string;
  receives: string;
  when: string;
}) {
  return (
    <tr className="border-b border-ink-800 align-top">
      <td className="py-3 pr-4 text-sm text-ink-100">{service}</td>
      <td className="py-3 pr-4 text-sm leading-relaxed text-ink-300">{receives}</td>
      <td className="py-3 text-sm leading-relaxed text-ink-300">{when}</td>
    </tr>
  );
}
