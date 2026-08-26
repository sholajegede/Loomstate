# Hackathon log

- **Project:** Loomstate
- **Event:** Convex All Gas Hackathon
- **What it does:** Loomstate rebuilds the goals you started on the web and never closed, keeps each one alive against the live web, and works it by email inside limits you set.
- **Live app:** not deployed
- **Repo:** https://github.com/sholajegede/Loomstate
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, actions, internal functions, HTTP actions, crons, scheduled functions, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-5-mini, with gpt-4.1-mini and gpt-4o-mini as fallbacks
- **Started:** 2026-08-26T21:21:20Z
- **Last updated:** 2026-08-26T23:20:00Z

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
Loomstate re-reads a watched page. Both changes made the risk gate testable:
an instruction to agree a purchase produced a high-risk, money-committing draft
that stayed in the queue behind a step-up check even with an Act grant
(`convex/agent.ts`, `convex/watches.ts`, `src/components/AgentPanel.tsx`).

### 2026-08-27 - working tree
Verified the outbound path end to end. The agent drafted an email citing the
Firecrawl price it had read, the owner approved it, and AgentMail delivered it.
The reply path is wired through a signed webhook: AgentMail posts to
`/x/agentmail`, Loomstate verifies the Svix signature against a per-workspace
secret it stores encrypted, records the reply on the loop, and schedules another
agent run.

Known limits at this point. The deployment is still development only, so no
public app URL exists yet. The AgentMail credential in use is scoped to one
inbox, so every agent currently shares that address instead of holding its own.
Firecrawl has reported only first-read diffs so far; a price or availability
change needs the watched page to actually change.
