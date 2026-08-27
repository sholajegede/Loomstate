# Loomstate

Loomstate reads how you use the web, rebuilds the goals you started and never
finished, keeps each one current against the live web, and works it for you
inside limits you set.

You never write a goal down. Loomstate works it out from what you read.

## The problem

You start things on the web all day. You compare three laptops. You look at a
flat. You research a visa. You get most of the way, then a meeting starts, and
the tabs close.

Nothing holds those goals. A bookmark holds a page, not a goal. A to-do list
holds what you remembered to type. Neither one knows the price changed, the
listing sold, or the deadline passed. The work sits still until you remember it,
and by then the world has moved.

Loomstate holds them for you. It sees what you were doing, keeps the pages
behind it under watch, and does the next small thing when something changes.

## What a loop is

A loop is one goal you are part way through.

Loomstate builds a loop from your own browsing. "Buy a used road bike under 800
pounds" is a loop. "Cycling" is not. A loop holds:

- the pages you read to get there
- a live watch on the pages that matter
- a next step, in plain words
- an aliveness score, from 0 to 100
- the authority the agent holds on it
- every email sent and received about it

## How it works

Six stages. Each one runs on a schedule, so all of it happens whether or not
you have Loomstate open.

**1. Capture.** A browser extension reports a page you read for more than four
seconds: the address, the title, and how long you stayed. It checks every page
against a block list of banking, payment, and health domains inside the browser,
so a blocked page never leaves your machine. The server checks the same list
again before storing anything.

**2. Reconstruct.** Every five minutes Loomstate reads the browsing that has no
loop yet and works out the goals behind it. It groups pages that serve the same
goal, names each loop, writes the next step, and ignores idle reading. It adds
new pages to an existing loop rather than starting a near-duplicate.

Each loop gets an aliveness score. The model does not pick that number.
Loomstate computes it from evidence: how recently you touched the loop, how many
pages it spans, how long you spent, whether the live web changed under it, and
one reading of how committed you looked. A score of 55 or more is active, 25 or
more is stalled, below that is dormant.

**3. Watch.** A new loop arrives already watched. Loomstate picks the pages
worth re-reading and skips search results, feeds, and home pages, which change
for reasons the loop does not care about. Every fifteen minutes it re-reads
those pages and records what changed: the price, whether it is still available,
whether the page is gone. It normalises the page first, so a site reflowing its
markup does not count as news.

**4. Work.** Every fifteen minutes Loomstate works the loops that have something
new. Something new means a change on the live web, a reply nobody has answered,
or a loop it has never looked at. A loop with nothing new is left alone.

The agent decides one action from the loop's own next step. Nobody types an
instruction. Where to write comes from the page itself: Loomstate reads the
contact off the listing it already fetched. If the page prints none, the loop
says so plainly rather than asking you to go and look one up.

**5. Govern.** Before anything is sent, the agent's authority is checked, the
draft is compared against what it has already sent, and the send limit is
counted. Any of the three can stop it.

**6. Approve.** An action that commits money or cannot be undone always waits
for you. Loomstate tells you by email and by a browser notification, and you can
answer either without opening the app.

## Governance

The agent is given authority deliberately, and it can be taken back.

**Tiers.** You choose once, and every loop follows it. **Watch** monitors and
tells you. **Draft** writes each email and waits for you to send it. **Act**
sends its own questions. A new workspace starts at Draft. Any loop can be set
apart from the rest.

**Grants.** A tier is a setting. A grant is the record that actually
authorises an action. It names the loop, the agent, the tier, the allowed
actions, and an expiry. Grants last 72 hours by default and revoke instantly.
An agent with no live grant cannot send anything. Its work goes to the
approval queue instead. No grant ever carries the right to commit money.

**The step-up gate.** Before any send the model classifies the action: does it
commit money, can it be undone, how risky is it. If it commits money, is
one-way, or scores high risk, it goes to the approval queue at every tier,
including Act, and needs a fresh passkey check inside five minutes. This gate is
code, not a line in a prompt, so the model cannot talk its way past it.

**Send limits.** A backstop in front of every send: three an hour and eight a
day for one loop, and eight an hour across the workspace. Going over stops that
loop, records why, and raises it for review. A stopped loop stays stopped until
a person clears it. The limits bind whether the agent sends by itself or you
approve the send, and they can be loosened in settings but never removed.

**Repeat protection.** A question the other side has answered is never asked
again. A draft that shares most of its wording with something already sent to
the same address is refused before it goes.

**The audit log.** Every action is recorded with the grant that authorised it,
the evidence behind it, the email, and the reply. It is append-only. You can
read it as one history or one agent at a time.

## Architecture

**Convex** is the whole backend and does real work throughout. It holds
twenty tables of its own, plus the tables auth brings, and every read goes
through an index. Scheduled functions run the three sweeps that make Loomstate
autonomous. HTTP actions take browsing from
the extension and replies from AgentMail. Live queries push a change straight to
the screen, so a loop moves while you watch it. Full-text search backs the loop
search, and paginated queries keep every list bounded. File storage serves the
web app itself, so the product and its backend share one origin and one deploy.

**OpenAI** rebuilds loops from raw browsing, labels each one, extracts the price
and availability from a fetched page, classifies how risky an action is, drafts
the email, and answers your questions in the chat. You bring your own key.

**Firecrawl** is what makes a loop alive rather than a saved note. It re-reads
the exact pages a loop is about and reports real change. Nothing else in the
product can tell you the price moved.

**AgentMail** gives the agent its own identity. It sends and receives real email
from an address that belongs to the agent, never from your own. A reply reaches
Loomstate through a signed webhook, lands on the loop, and starts the next
agent run.

Auth is Convex Auth with passkeys. There is no password.

## The web app and the extension

They are two halves of one product.

The **web app** is the full surface: the intent map, a loop with its watches and
diffs and email, the approval queue, the audit log, a chat that answers from
your own records, and settings.

The **extension** is the sensor and a place to live. It captures browsing, and
it shows your loops, what needs you, and what the agent just did, without
opening the app. You can approve or reject an action from a browser
notification. You can file the page you are on into a loop, or start a new one
from it.

The split of authority between them is deliberate. The extension holds a pairing
token, which is a weaker credential than the passkey session the web app holds,
so it is given less power. It can reject anything and approve an ordinary
action. It can never release money: that needs the passkey, and only the app can
ask for one. When you press approve on a gated action in the browser, it opens
the app at that action instead.

## The chat

Ask Loomstate what is going on, either about one loop or about everything.

Every answer is built from records fetched first: the pages you read, the
watches and what they found, the email, the approvals, the grants, the audit
log. The model is given that text and told to answer from it alone. Each reply
says what it read. When the records do not hold the answer, it says so instead
of inventing one.

## Setup

Loomstate cannot do anything without a key, and it sees nothing without a paired
browser, so a new account is walked through three steps. Each step reads what is
actually true, so leaving halfway and coming back shows what is still missing.

1. **Add your OpenAI key.** Loomstate checks it against OpenAI, then encrypts it
   with AES-GCM under a key held only in the deployment environment. It is never
   sent to the extension.
2. **Connect your browser.** Load the extension, create a pairing token, and
   paste it in. The step ticks itself the moment pairing succeeds.
3. **Choose how much the agent may do.** Draft is recommended and preselected.

Until a key exists, the app explains what is missing rather than showing an
empty screen that quietly does nothing.

## Run it

```bash
npm install
npx convex dev      # the first run creates your deployment
npm run dev:web
```

Set these on the deployment:

```bash
npx convex env set "FIRECRAWL_API_KEY=..."     # the alive-engine
npx convex env set "AGENTMAIL_API_KEY=..."     # the agent's inbox
npx convex env set "SITE_URL=http://localhost:5173"
```

The OpenAI key is added in the app, not here, because it belongs to the person
rather than the deployment.

Load the extension from `extension/` at `chrome://extensions` with Developer
mode on. See [extension/README.md](extension/README.md).

## What Loomstate does not do

Stated plainly, because a demo that hides its edges is worth less than one that
names them.

- **Email is the only way it acts.** It does not press buttons on a site or
  call a marketplace API. Real marketplace actions are the next step, not a
  shipped one.
- **It needs a contact on the page.** Many listings hide the seller behind a
  form. Loomstate records that as a blocker rather than guessing an address.
- **One inbox for now, if your credential is scoped to one.** The design gives
  each agent its own address, and it does when the AgentMail credential allows
  it. A credential scoped to a single inbox makes every agent share that one.
- **One person per workspace.** Read-only viewers are in the schema and not yet
  built.
- **The agent judges its own risk.** The gate that routes money to a human is
  code, and the caps are code, but the classification feeding them is a model
  call. The backstops exist because that judgment can be wrong.
- **Reconstruction costs your tokens.** Every sweep that finds new browsing
  spends against your own key.

## Repository

```
convex/        the backend: schema, queries, mutations, actions, crons, HTTP
convex/lib/    the parts that talk outward: OpenAI, Firecrawl, AgentMail, crypto
src/           the web app
extension/     the Manifest V3 browser extension
scripts/       publishing the built app to the deployment
```

The build log for the Convex All Gas Hackathon is in
[hackathon.md](hackathon.md). It records what was built, in order, including the
bugs found on the way and what they turned out to be.
