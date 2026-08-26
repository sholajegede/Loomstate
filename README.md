# Loomstate

Loomstate watches how you use the web, rebuilds the goals you started and never
closed, keeps each one alive against the live web, and works it for you inside
limits you set.

## What a loop is

A loop is one goal you are part way through. Loomstate builds a loop from your
own browsing signal. You never write the goal down.

Each loop holds:

- the pages you read to get here
- a live watch on the pages that matter
- the next step the agent proposes
- the grant that says what the agent may do

## How it works

1. A browser extension streams page visits to Convex.
2. Loomstate groups the visits into loops and labels each one.
3. Firecrawl re-reads the watched pages and reports real change.
4. An agent with its own email address acts on the change.
5. Any action that spends money or cannot be undone waits for your approval.

## Stack

- **Convex** for the database, functions, scheduling, and live queries
- **OpenAI** to rebuild loops, judge risk, and draft email
- **Firecrawl** to re-read watched pages and detect change
- **AgentMail** to give each agent its own inbox

## Run it

```bash
npm install
npx convex dev      # first run creates your deployment
npm run dev:web
```

The build log for the Convex All Gas Hackathon is in [hackathon.md](hackathon.md).
