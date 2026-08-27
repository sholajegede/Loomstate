# Hackathon log

- **Project:** Loomstate
- **Event:** Convex All Gas Hackathon
- **What it does:** Loomstate rebuilds the goals you started on the web and never closed, keeps each one alive against the live web, and works it by email inside limits you set.
- **Live app:** https://incredible-sardine-959.convex.site
- **Repo:** https://github.com/sholajegede/Loomstate
- **Frontend:** Convex static hosting
- **Convex deployment:** https://incredible-sardine-959.convex.cloud
- **Components:** none
- **Convex features:** schema, tables, indexes, full-text search, paginated queries, queries, mutations, actions, internal functions, HTTP actions, crons, scheduled functions, file storage, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-5-mini by default, with gpt-4.1-mini and gpt-4o-mini as fallbacks. The chat model is chosen by the owner from what their own key reaches.
- **Started:** 2026-08-26T21:21:20Z
- **Last updated:** 2026-08-27T21:20:00Z

## Log

### 2026-08-26
Set up the development environment. No application code existed yet. The project
root held editor settings and a private project instruction file. Installed the
official Convex plugin for Claude Code at user scope, which supplies the Convex
skills and the Convex MCP server. Installed the hackathon build-log skill at
`.claude/skills/convex-hackathon-skill/`. Chose Convex static hosting as the
frontend host for the submission. This project was not a Convex project yet, so
the Convex AI project files were not installed. No Git history existed, so the
start time above comes from file modification times and is weaker evidence.

### 2026-08-26 - 72f00e4
Scaffolded the Convex backend and the web client. Wrote the full data model in
one pass: users, workspaces, viewers, devices, events, loops, watches,
snapshots, diffs, agents, grants, agentRuns, messages, approvals, auditLog,
secrets, and blocklist, each with the indexes its read paths need. Built the app
shell on Vite, React, and Tailwind with routes for the intent map, signal,
approvals, audit log, and settings. Convex features: schema, tables, indexes
(`convex/schema.ts`, `src/App.tsx`).

### 2026-08-26 - ce828a6
Added passkey sign-in and workspace bootstrap. A new owner signs in with a
passkey, and Loomstate creates their workspace plus a default block list of
banking, payment, and health domains on first sign-in. Convex features: queries,
mutations, HTTP actions (`convex/auth.ts`, `convex/auth.config.ts`,
`convex/http.ts`, `convex/workspaces.ts`, `convex/lib/access.ts`,
`src/routes/SignIn.tsx`).

Auth runs on `@convex-dev/auth` with the passkey provider. Every read and write
path goes through `convex/lib/access.ts`, which resolves the caller to a user
and a workspace and refuses anything outside it.

### 2026-08-26 - 250161e, ad04943
Shipped the browsing sensor. A Manifest V3 extension reports the pages you read
for more than four seconds, and the dashboard renders them live. Pairing issues
a token once; Loomstate stores only its SHA-256 hash, so the token cannot be
read back. The extension checks every page against a block list inside the
browser, and the server checks the same list again before it stores anything.
Convex features: HTTP actions, internal mutations, indexes, realtime queries
(`convex/http.ts`, `convex/ingest.ts`, `convex/devices.ts`, `convex/events.ts`,
`extension/background.js`, `extension/exclusions.js`, `src/routes/Signal.tsx`).

### 2026-08-26 - 750e27a
Loomstate now rebuilds loops from real browsing signal. It reads the events that
have no loop yet, groups the ones that serve the same goal, and labels each loop
with a title, a type, a summary, and a next step. Verified on 23 captured pages:
it produced 5 loops, including a buying loop for an iPhone listing on a Nigerian
classifieds site.

The aliveness score is computed in code, not by the model. It combines recency,
breadth, attention, detected change, and one `momentum` judgment the model
supplies, so the number stays explainable. BYOK keys are encrypted with AES-GCM
under a server-only key and checked against the provider before they are stored.
Convex features: actions, internal queries and mutations, indexes
(`convex/loops.ts`, `convex/lib/aliveness.ts`, `convex/lib/openai.ts`,
`convex/secrets.ts`, `convex/lib/crypto.ts`).

### 2026-08-26 - c1a1d40
Added the alive-engine. Loomstate re-reads a loop's pages with Firecrawl,
extracts the price and availability, and records a diff when either changes. A
normalizer strips view counts, timestamps, and tracking parameters before
hashing, so a repeat read of an unchanged page reports no change. A cron sweeps
every watch that is due. A real change raises the loop's aliveness score and
moves it up the intent map. Convex features: crons, actions, internal actions,
indexes (`convex/watches.ts`, `convex/lib/firecrawl.ts`, `convex/crons.ts`,
`src/components/Watches.tsx`).

Verified against a live listing: Loomstate read ₦1,300,000 and availability
`available`, then reported no change on the second read.

### 2026-08-27 - 096dfe4, 3a81c60
Gave each loop an agent, a revocable grant, and an approval queue.

The agent owns an AgentMail inbox and never sends from the owner's own email. A
grant is a separate record with a tier, an allowed-action list, a spend cap, and
an expiry; it revokes instantly and expires by default. An agent holds no
authority without one.

The risk gate is code, not a prompt. Before any send, the model classifies
whether the action commits money and whether it can be undone. Anything that
commits money, cannot be undone, or scores high risk routes to the approval
queue at every tier, including Act, and needs a step-up passkey check inside a
five-minute window. The server enforces the window; the interface only shows it.
Every action lands in the append-only audit log with the grant that allowed it
and the Firecrawl evidence behind it.

AgentMail credentials scoped to a single inbox cannot create more, so the agent
falls back to the inbox the credential already owns instead of failing.
Convex features: actions, internal actions, HTTP actions, scheduled functions,
indexes (`convex/agent.ts`, `convex/agents.ts`, `convex/grants.ts`,
`convex/approvals.ts`, `convex/inbound.ts`, `convex/email.ts`,
`convex/lib/agentmail.ts`, `src/routes/Approvals.tsx`).

### 2026-08-27 - f150232, 5fba2a2
The owner can now tell the agent what to do on a loop and choose how often
Loomstate re-reads a watched page. The instruction field made the risk gate
testable: an instruction to agree a purchase produced a high-risk,
money-committing draft that stayed in the approval queue behind a step-up check
(`convex/agent.ts`, `convex/watches.ts`, `src/components/AgentPanel.tsx`).

At this point the loop still carried no grant, so this run only proved the gate
holds with no authority. The Act-tier case is proved in a later entry.

### 2026-08-27 - 14b5844
Verified the outbound path end to end. The agent drafted an email citing the
Firecrawl price it had read, the owner approved it, and AgentMail delivered it.

### 2026-08-27 - 077785c
Closed the reply loop and fixed a gap it exposed.

A Gmail reply reached the agent inbox, AgentMail posted it to `/x/agentmail`,
Loomstate verified the Svix signature against the per-workspace secret it holds
encrypted, recorded the reply on the loop, and scheduled a follow-up agent run
within 100ms. The loop moved from aliveness 56 to 100, its last activity moved
to the reply time, and the follow-up run rewrote the next step to reflect the
answer.

That run also exposed a real bug: the authority buttons did nothing when a loop
had no agent yet, so a grant was never recorded. Setting authority now gives the
loop an agent first. With a live Act grant in force, an instruction to commit
₦1,300,000 was still refused and routed to the approval queue behind a step-up
passkey check. The audit log shows `grant.create` for act authority followed by
`approval.request`, which is the gate holding at the highest tier rather than at
no tier at all.

### 2026-08-27 - 1c62867
Loomstate now serves its own web app. The built files live in Convex file
storage, and the HTTP router answers every page route from them, so the product
and its backend share one `convex.site` origin and one deploy. Assets carry a
one-year cache; the app shell revalidates so a publish reaches open tabs. The
publish endpoint is guarded by a token held in the server environment
(`convex/site.ts`, `convex/http.ts`, `scripts/publish-site.mjs`).

This replaced the hosted publishing gateway, which returned 502 on every
authenticated upload while this was built. Serving from the deployment removed
the outside dependency and put the app on the `convex.site` origin directly.

### 2026-08-27 - deployed
Deployed to production. The backend and all nine environment variables are set
on the production deployment, and the web app is published to
https://incredible-sardine-959.convex.site. Deep links, asset caching, the
browsing-event endpoint, and the publish endpoint all answer correctly there,
and each endpoint refuses an unknown token. The scheduled sweep was observed
running on production, and the passkey endpoints answered a real sign-in
challenge from the live page.

Known limits at this point. Production holds its own database, so the loops and
events built during development do not exist there; the demo path is re-run on
the live deployment from a fresh sign-in. The AgentMail credential in use is
scoped to one inbox, so every agent shares that address instead of holding its
own. Firecrawl has reported only first-read diffs so far; a price or
availability change needs the watched page to actually change.

### 2026-08-27 - 3450566
Turned the interaction model the right way round.

Before this, a person had to do the agent's work through forms: pick an
authority tier, type the seller's address, write an instruction, press a button,
then open the approval queue. That is a dashboard, not an agent. Loomstate now
runs on its own and pulls the person in only to approve an action it may not
take alone.

- Reconstruction is ambient. A cron rebuilds loops from new browsing signal
  every five minutes. "Re-scan now" stays as a manual re-scan, demoted to a
  secondary control.
- A new loop arrives already watched. Loomstate picks the pages worth re-reading
  and skips search pages, feeds, and home pages, which change for reasons the
  loop does not care about.
- A cron works every loop that has something new: an unread change on the live
  web, an unanswered reply, or a loop never looked at. The agent decides from
  the loop's own next step. Nobody types an instruction.
- The agent reads the counterparty's address off the page Firecrawl already
  fetched. When a page prints none, the loop records "No contact found on the
  watched pages" as a blocker instead of asking the person to look one up.
  Manual entry stays as an escape hatch.
- Authority is set once in settings and every loop inherits it. Loomstate
  materialises the grant record itself. A workspace built before the setting
  existed adopts it once, so old loops do not sit still forever.
- The step-up gate is untouched. Money and one-way actions still wait for a
  fresh passkey check, whatever the standing authority says.

Confirmed on the live deployment: all three sweeps fire on their own
(`reconstruct` every five minutes, `sweep` and `work` every fifteen), two loops
seeded ten watches between them without anyone pressing Watch, both loops
received an `act` grant nobody filled in a form for, both were worked under
`trigger: "schedule"`, and one recorded the no-contact blocker rather than
asking. Contact extraction was proved end to end against a page that does print
an address; the address and its source URL landed on the loop with no typing,
and the test was then cleared and its watch stopped.

One consequence worth stating plainly: with the standing authority at `act`, the
agent sends its own low-stakes questions to addresses it reads off pages,
without a person seeing them first. That is the autonomy this design asks for.
`Draft` keeps every outgoing email behind approval for anyone who wants that
instead, and `Pause` stops the agent across the workspace.

### 2026-08-27 - e6cf7bd
A new workspace now starts at draft authority, so every outgoing email waits for
approval until the owner decides otherwise. Act and Pause stay one click away in
settings. Workspaces that already exist keep the authority they had
(`convex/workspaces.ts`, `convex/loops.ts`).

### 2026-08-27 - 4d71a41
Closed the hole in "shut the tab and let it run": the agent kept working, but a
waiting approval reached nobody.

Creating an approval now raises one server-side event that fans out to two
channels. The extension polls for queued alerts on its own alarm and raises a
browser notification; selecting it opens the approval on the live URL. The agent
also emails the owner from its own inbox with the loop, the reason, the drafted
action, and the link. Both start from the moment the approval is written, so
neither depends on the app or the extension being open.

An approval is stamped the first time it is announced, so nobody is told twice.
Nothing else notifies: an action the agent may take inside its grant never
reaches the owner, because nothing is waiting on them. Convex features: scheduled
functions, HTTP actions, internal actions, indexes (`convex/notifications.ts`,
`convex/http.ts`, `convex/agent.ts`, `extension/background.js`).

Confirmed on the live deployment: a money-committing action produced a pending,
step-up-gated approval; the audit log recorded "Loomstate told the owner through
a browser notification and an email"; a second announcement of the same approval
was refused; and draining the queue through the device endpoint returned the
alert once and nothing on the next call. Earlier autonomous cycles that acted
inside their grant produced no notifications at all.

### 2026-08-27 - c527d67
Fixed a false change the notification work exposed. Firecrawl reported the price
on a listing moving from "₦ 2,850,000" to "₦2,850,000", which is the same price
with different spacing. Prices and availability are now compared with spacing
and case removed, so a site reflowing its markup no longer wakes the agent
(`convex/lib/firecrawl.ts`, `convex/watches.ts`).

### 2026-08-27 - 11e5778, and the send cap
Stopped a runaway. On the live workspace the agent re-emailed the same seller
seventeen times in an hour, walking a purchase negotiation forward on its own.

What went wrong, in order. An inbound reply scheduled an agent run immediately,
which skipped the sweep's cooldown entirely. The loop had no memory of which
question it had asked, only a free-text next step it rewrote every run, so it
invented a fresh version of the same ask each time: deposit, then bank details,
then collection address, then hold terms, then confirm transfer. Readiness was
judged on unread page changes, which nothing ever marked read, so scheduled
passes stayed hot forever. Nothing compared a draft against what had already
gone out, and nothing capped sending.

Four fixes, each independent of the others.

- A loop now records the question it has out and the questions already answered.
  A reply settles the open question, and a settled question is never asked
  again, however differently the model words it.
- A run with nothing newer than the last run is a no-op. Readiness is judged on
  new information arriving, not on time passing.
- Before any send, the draft is compared against recent outbound email to the
  same address by shared meaningful words. A near-duplicate is refused.
- A hard cap sits in front of every send: three an hour and eight a day for one
  loop, eight an hour across a workspace. Going over stops that loop, writes the
  reason to the audit log, and raises it for review. A stopped loop stays
  stopped until a person clears it.

The live workspace also moved from act to draft, and its act grants were retired,
so outbound negotiation waits for approval rather than going out by itself.

Confirmed on the live deployment against the real incident data: the cap refused
a send with "the agent sent 16 emails in an hour, which is over the limit of 3",
stopped that loop, and queued a notification linking to it; a stopped loop
returns "paused" and does no work; a loop with nothing new returns "Nothing new
on this loop since the agent last looked"; the scheduled sweep now finds nothing
to do; and a reply moved an open question into the answered list and cleared it.

### 2026-08-27 - 8fa390f
The send limit now binds to approved email as well as autonomous email. A person
pressing approve is deliberate, but a loop already far over its limit is still
the wrong thing to send from, however the send started. The approval stays
pending and says why, rather than being spent.

A loop can also be removed now, with everything it holds: its email, approvals,
grants, runs, watches, snapshots, changes, notifications, and its own audit
entries. The browsing events survive and are detached, because the pages a
person read are theirs and were never the problem. Removing a loop is available
on the loop page (`convex/loops.ts`, `convex/approvals.ts`,
`src/routes/LoopDetail.tsx`).

Both deployments were then cleared of the incident. Production lost the MacBook
loop, which carried 37 messages, 63 audit entries, and a synthetic test message
holding a made-up bank account. Development lost the iPhone loop, which carried
the same runaway negotiation across 43 messages and 70 audit entries. Nine and
three browsing events respectively were detached rather than deleted. A scan of
both databases for the test artifacts now returns nothing in messages, audit
entries, approvals, or notifications, and neither deployment holds any email at
all.

### 2026-08-27 - 01f7488
Two read surfaces over data that already existed. Neither touches the agent, the
crons, or the send path.

The nav now carries every loop, finished ones included. It searches titles
through a Convex full-text index and filters by status, type, and aliveness, with
live counts per status. Reads are paginated and always enter through an index:
the search index when there is a term, the status or type index when one is
picked, and the activity index otherwise. Filters an index cannot carry are
applied to the page that was already fetched, so the read stays bounded whatever
is selected.

The audit view reads the same log under two lenses. Aggregate shows every agent
as one history through the workspace index. Per-agent shows one agent's own
history through an index on the agent. Both filter by loop, action, and time, and
each entry carries the provenance already recorded: which grant authorised it and
when that grant expires, the Firecrawl evidence with its before and after, the
email body, and a link to the loop. The view only reads
(`convex/loops.ts`, `convex/auditLog.ts`, `src/components/LoopsSidebar.tsx`,
`src/routes/AuditLog.tsx`).

### 2026-08-27 - bc910ba, 3bf247d
A chat over what Loomstate already recorded. It reads and answers; it sends
nothing and changes no agent state.

Two scopes. A loop chat opens on the loop page and is grounded in that loop's
own records: the pages the person read, the pages Loomstate watches and the
changes it found, the email in both directions, the agent runs, the approvals,
the live grant, and the audit entries. A workspace chat at `/ask` is grounded in
recent activity across every loop, plus what is waiting for approval and whether
the agent is paused.

Retrieval happens before the model is asked anything. Each scope has an internal
query that reads records through an index, with a fixed cap on every read, and
renders them as text. The model is given that text and told to answer from it
alone: cite the price, subject line, or audit entry behind a claim, and say
plainly when the records do not show the answer. Every reply carries a line
naming what it read, such as "read the loop record, the authority grants, 7
browsing events, 3 watched pages, 15 detected changes". The workspace OpenAI key
does the answering, so this costs the owner nothing extra
(`convex/chat.ts`, `convex/lib/openai.ts`, `src/components/Chat.tsx`,
`src/routes/AskLoomstate.tsx`).

Checked against real data before shipping. Asked what it had done, it named the
four loops, the agent address, the standing authority, the domains being
watched, and that nothing waited for approval. Asked about a seller, a laptop
model, and a phone number that appear in no record, it answered that the records
do not show them rather than inventing any of it. Asked what changed on a loop,
it quoted four availability transitions with their timestamps and before and
after values.

Deploying also exposed a real gap: the deployment serves the web app itself from
a fixed list of page routes, and a new route added to the client answers 404
until it is added there too. The list is now named and commented, and every page
route was checked on the live deployment.

### 2026-08-27 - the chat box
Three additions to the chat. It stays read-only.

Dictation. A microphone in the chat field uses the browser's own speech
recognition to turn speech into text in the box, so a person can correct it
before asking. It is input only and never speaks back. Where a browser has no
such API the button is not shown at all, and a refused microphone says so rather
than failing quietly.

A model picker. The list is fetched from the owner's own key, so it shows the
chat models that key actually reaches rather than a list Loomstate imagines.
The choice is kept for the workspace.

An effort control, shown only for a model that takes one. OpenAI's model list
says what a key can reach but not what each model supports, so the rule is by
family and deliberately narrow: a model Loomstate does not recognise is treated
as having no effort setting rather than being guessed at
(`convex/lib/models.ts`, `convex/models.ts`, `src/lib/speech.ts`,
`src/components/AnswerSettings.tsx`).

Testing against the real key found two things worth fixing. The first rule for
non-reasoning models matched `gpt-5-chat-latest` but not `gpt-5.1-chat-latest`,
so a chat model was being offered an effort setting it does not have; the rule
now covers every point version. The second: a reasoning model can still refuse a
particular effort value, which would have failed the answer outright, so a
refusal on that parameter now drops it and asks the same model again.

### 2026-08-27 - answering from the browser
An action that needs a decision now reaches the person wherever they are
browsing, and can be answered without opening the app.

The extension raises a notification carrying the loop, the proposed action, and
why it is waiting. **Approve** and **Reject** sit on the notification itself.
The popup shows the same actions in full, with a box for a note.

A device token is a bearer token in extension storage, which is a weaker
credential than the passkey session the web app holds, so it is given less
authority. It may reject anything, and it may approve an action that needs no
step-up. It may never release money or a one-way action: the endpoint refuses
and answers with a link that opens the app at that action, where the passkey
check happens. The gate is unchanged; it is just reachable from one more place.

Both routes end in the same function. The web action checks the person is
signed in, the device route checks the token, and each then calls one shared
body that sends the email, marks the approval, and writes the audit entries. The
trails come out identical.

Confirmed against the live deployment. A device token holding a real pairing was
refused on a money-committing action and handed back the app link; the action
stayed pending until the passkey check was done in the web app. A non-gated
action approved from the device in one call and sent. A rejection from the
device recorded the note and closed the action, and a second decision on it was
refused. The two trails match entry for entry, apart from the step-up entries
the gated one correctly carries.

Testing found a provenance bug worth naming. Recording a note was also stamping
where the decision was made, so an action annotated from the extension and then
approved in the web app after a passkey check was filed as decided by the
extension. A note is not a decision. The origin is now written when the action
is actually released.

### 2026-08-27 - the browser panel
The extension became somewhere a person can live, rather than a pairing screen
with a count on it.

It now shows what is waiting and lets them answer it, their loops with status
and how live each one is, what the agent has just done, and whether Loomstate is
paused. Selecting a loop opens it in the web app. **Keep this open while I
browse** moves the same panel to the side of the window, where it stays while
they work.

Quick-add files the page they are on: into a loop they pick, or into a new one
they name. Loomstate stores the page and starts watching it, unless the page is
on their excluded list, in which case it stores nothing and says so. Filing by
hand goes through the same block list as captured browsing, because a rule that
only holds when nobody presses a button is not a rule.

One bounded read fills the whole panel: the paused flag, the counts, a page of
loops, the recent activity, and the approvals waiting. Every read enters through
an index and is capped, and the loop list is paginated with a cursor, so a large
workspace does not make the panel slow. The full history stays in the web app
(`convex/deviceView.ts`, `convex/http.ts`, `extension/popup.js`).

Confirmed against the live deployment with a real pairing: the overview returned
the paused state, the counts, two loops with a cursor, and six activity entries
in one call; the cursor fetched the next page and reported the end; filing a
page started a loop and watched it; filing a second page attached it to that
loop and watched that too; and a manual add of a banking domain was refused with
the reason.

Removing a loop also improved. Captured browsing is still detached rather than
deleted, because the pages a person read are theirs. A page filed by hand is
deleted with its loop: it exists only as part of that loop, and leaving it
behind seeded a loop nobody had asked for.
