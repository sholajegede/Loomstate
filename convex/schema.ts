import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const loopType = v.union(
  v.literal("buying"),
  v.literal("research"),
  v.literal("planning"),
  v.literal("other"),
);

export const loopStatus = v.union(
  v.literal("active"),
  v.literal("stalled"),
  v.literal("dormant"),
  v.literal("closed"),
);

/** Autonomy tier granted to an agent on a loop. */
export const autonomyTier = v.union(
  v.literal("watch"),
  v.literal("draft"),
  v.literal("act"),
);

export const approvalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("expired"),
);

/** A piece of Firecrawl evidence attached to an action or approval. */
export const evidence = v.object({
  watchId: v.optional(v.id("watches")),
  diffId: v.optional(v.id("diffs")),
  url: v.string(),
  label: v.string(),
  before: v.optional(v.string()),
  after: v.optional(v.string()),
  observedAt: v.number(),
});

export default defineSchema({
  ...authTables,

  // Overrides the users table from authTables. The auth fields must stay
  // optional; Convex Auth writes only the ones a provider supplies.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    defaultWorkspaceId: v.optional(v.id("workspaces")),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  workspaces: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    createdAt: v.number(),
    // The authority every new loop inherits. Set once, not per action.
    defaultTier: v.optional(autonomyTier),
    autopilot: v.optional(v.boolean()),
    // What the chat answers with. Chosen once, kept for the workspace.
    chatModel: v.optional(v.string()),
    chatEffort: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    // The send backstop. Absent means the built-in limit, so a workspace that
    // never touches these behaves exactly as it did before they existed.
    sendCapLoopHourly: v.optional(v.number()),
    sendCapLoopDaily: v.optional(v.number()),
    sendCapWorkspaceHourly: v.optional(v.number()),
    // Which channels an approval reaches the owner through. Absent means on.
    notifyEmail: v.optional(v.boolean()),
    notifyBrowser: v.optional(v.boolean()),
    // First-run setup. Done means the owner finished it, skipped means they
    // chose to come back later. Neither set means they have not seen it.
    setupDoneAt: v.optional(v.number()),
    setupSkippedAt: v.optional(v.number()),
  }).index("by_owner", ["ownerId"]),

  /** Read-only watchers invited to a workspace. */
  viewers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    role: v.union(v.literal("viewer")),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_email", ["email"]),

  /** A paired browser extension. The token is the extension's only credential. */
  devices: defineTable({
    workspaceId: v.id("workspaces"),
    label: v.string(),
    tokenHash: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_token_hash", ["tokenHash"]),

  /** Raw browsing signal streamed from the extension. */
  events: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.optional(v.id("devices")),
    url: v.string(),
    host: v.string(),
    path: v.string(),
    title: v.string(),
    query: v.optional(v.string()),
    kind: v.union(
      v.literal("visit"),
      v.literal("dwell"),
      v.literal("search"),
      v.literal("manual"),
    ),
    dwellMs: v.number(),
    occurredAt: v.number(),
    loopId: v.optional(v.id("loops")),
    clusteredAt: v.optional(v.number()),
  })
    .index("by_workspace_time", ["workspaceId", "occurredAt"])
    .index("by_workspace_unclustered", ["workspaceId", "clusteredAt"])
    .index("by_workspace_url", ["workspaceId", "url"])
    .index("by_loop", ["loopId"])
    .index("by_workspace_host", ["workspaceId", "host"]),

  /** An intent thread reconstructed from browsing signal. */
  loops: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    summary: v.string(),
    type: loopType,
    status: loopStatus,
    aliveness: v.number(),
    nextStep: v.string(),
    sourceUrls: v.array(v.string()),
    keywords: v.array(v.string()),
    tier: autonomyTier,
    eventCount: v.number(),
    lastActivityAt: v.number(),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
    // Where the agent writes, read off the watched page rather than typed in.
    contactEmail: v.optional(v.string()),
    contactSource: v.optional(v.string()),
    // Why the agent cannot move, in the owner's words. Null when it can.
    blockedReason: v.optional(v.string()),
    lastWorkedAt: v.optional(v.number()),
    watchesSeeded: v.optional(v.boolean()),
    // When information the agent has not acted on last arrived. A run with
    // nothing newer than lastWorkedAt is a no-op.
    lastSignalAt: v.optional(v.number()),
    // The question the agent has out and is waiting on, and the questions it
    // already asked and got an answer to. A settled step is never re-sent.
    openStepKey: v.optional(v.string()),
    openStepAt: v.optional(v.number()),
    answeredStepKeys: v.optional(v.array(v.string())),
    // Set when a backstop trips. The agent sends nothing until a human clears it.
    agentPausedAt: v.optional(v.number()),
    agentPauseReason: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_type", ["workspaceId", "type"])
    .index("by_workspace_activity", ["workspaceId", "lastActivityAt"])
    .index("by_workspace_aliveness", ["workspaceId", "aliveness"])
    .index("by_status_worked", ["status", "lastWorkedAt"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["workspaceId", "status", "type"],
    }),

  /** A Firecrawl target that keeps one loop alive against the live web. */
  watches: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    url: v.string(),
    label: v.string(),
    intervalMinutes: v.number(),
    active: v.boolean(),
    lastCrawlAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastSnapshotId: v.optional(v.id("snapshots")),
    createdAt: v.number(),
  })
    .index("by_loop", ["loopId"])
    .index("by_loop_url", ["loopId", "url"])
    .index("by_workspace", ["workspaceId"])
    .index("by_active_crawl", ["active", "lastCrawlAt"]),

  /** One Firecrawl read of a watched page. */
  snapshots: defineTable({
    workspaceId: v.id("workspaces"),
    watchId: v.id("watches"),
    capturedAt: v.number(),
    contentHash: v.string(),
    title: v.optional(v.string()),
    price: v.optional(v.string()),
    availability: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    excerpt: v.string(),
    markdown: v.optional(v.string()),
    ok: v.boolean(),
  })
    .index("by_watch_time", ["watchId", "capturedAt"])
    .index("by_workspace", ["workspaceId"]),

  /** A detected change between two snapshots of one watch. */
  diffs: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    watchId: v.id("watches"),
    fromSnapshotId: v.optional(v.id("snapshots")),
    toSnapshotId: v.id("snapshots"),
    kind: v.union(
      v.literal("price"),
      v.literal("availability"),
      v.literal("content"),
      v.literal("gone"),
      v.literal("first_seen"),
    ),
    field: v.string(),
    before: v.optional(v.string()),
    after: v.optional(v.string()),
    summary: v.string(),
    detectedAt: v.number(),
    seenAt: v.optional(v.number()),
  })
    .index("by_loop_time", ["loopId", "detectedAt"])
    .index("by_watch", ["watchId"])
    .index("by_workspace_time", ["workspaceId", "detectedAt"]),

  /** An acting agent. It owns an AgentMail inbox and never uses the user's email. */
  agents: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.optional(v.id("loops")),
    name: v.string(),
    inboxAddress: v.string(),
    inboxId: v.string(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_loop", ["loopId"])
    .index("by_inbox_address", ["inboxAddress"]),

  /** A revocable, expiring authority record. An agent can do nothing without one. */
  grants: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.id("agents"),
    tier: autonomyTier,
    allowedActions: v.array(v.string()),
    spendCapCents: v.number(),
    grantedBy: v.id("users"),
    grantedAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_loop", ["loopId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_agent", ["agentId"]),

  /** A scheduled sweep or an on-demand run of the agent over one loop. */
  agentRuns: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.optional(v.id("agents")),
    trigger: v.union(
      v.literal("schedule"),
      v.literal("manual"),
      v.literal("diff"),
      v.literal("inbound_email"),
    ),
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    steps: v.array(
      v.object({
        at: v.number(),
        label: v.string(),
        detail: v.optional(v.string()),
      }),
    ),
    outcome: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_loop_time", ["loopId", "startedAt"])
    .index("by_workspace_time", ["workspaceId", "startedAt"]),

  /** Real email sent and received by an agent, linked to a loop. */
  messages: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.id("agents"),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    threadId: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    from: v.string(),
    to: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
    sentAt: v.number(),
    approvalId: v.optional(v.id("approvals")),
  })
    .index("by_loop_time", ["loopId", "sentAt"])
    .index("by_thread", ["threadId"])
    .index("by_workspace_time", ["workspaceId", "sentAt"]),

  /** The human-in-the-loop queue. Money and irreversible actions always land here. */
  approvals: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.id("agents"),
    agentRunId: v.optional(v.id("agentRuns")),
    actionType: v.string(),
    actionPayload: v.any(),
    reason: v.string(),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reversible: v.boolean(),
    commitsMoney: v.boolean(),
    evidence: v.array(evidence),
    status: approvalStatus,
    stepUpRequired: v.boolean(),
    stepUpConfirmedAt: v.optional(v.number()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
    editedPayload: v.optional(v.any()),
    // Stamped once, so an approval is announced exactly one time.
    notifiedAt: v.optional(v.number()),
    // Raised because the owner asked for it again, rather than because the
    // agent found something new. Shown on the card so nobody mistakes a
    // rehearsal for the agent acting on its own.
    proposedByOwner: v.optional(v.boolean()),
    // Where the send goes when approved, when that is not the loop's contact.
    routedTo: v.optional(v.string()),
    // What the person said when they decided, and where they decided it.
    decisionNote: v.optional(v.string()),
    decidedVia: v.optional(v.union(v.literal("web"), v.literal("extension"))),
  })
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_loop", ["loopId"]),

  /** Append-only. Every agent action, with the grant that authorized it. */
  auditLog: defineTable({
    workspaceId: v.id("workspaces"),
    loopId: v.optional(v.id("loops")),
    agentId: v.optional(v.id("agents")),
    grantId: v.optional(v.id("grants")),
    approvalId: v.optional(v.id("approvals")),
    actorType: v.union(
      v.literal("agent"),
      v.literal("user"),
      v.literal("system"),
    ),
    action: v.string(),
    detail: v.string(),
    inputs: v.optional(v.any()),
    evidence: v.optional(v.array(evidence)),
    result: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_workspace_time", ["workspaceId", "at"])
    .index("by_loop_time", ["loopId", "at"])
    .index("by_agent_time", ["agentId", "at"])
    .index("by_workspace_action", ["workspaceId", "action"]),

  /** BYOK material. Encrypted server-side. Never sent to the extension. */
  secrets: defineTable({
    workspaceId: v.id("workspaces"),
    provider: v.union(
      v.literal("openai"),
      v.literal("firecrawl"),
      v.literal("agentmail_webhook"),
    ),
    ciphertext: v.string(),
    iv: v.string(),
    hint: v.string(),
    updatedAt: v.number(),
  }).index("by_workspace_provider", ["workspaceId", "provider"]),

  /**
   * The chat a person holds with Loomstate about their loops. A turn here is a
   * question and an answer over records that already exist. Nothing in this
   * table changes what an agent does.
   */
  chatTurns: defineTable({
    workspaceId: v.id("workspaces"),
    // Set for a chat opened from one loop. Absent for the workspace chat.
    loopId: v.optional(v.id("loops")),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    // What the answer was built from, so a reader can check it.
    sources: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_loop_time", ["loopId", "at"])
    .index("by_workspace_scope_time", ["workspaceId", "loopId", "at"]),

  /**
   * Things the owner must be told about, on whatever device they have. The
   * extension drains this so a waiting approval reaches them with the app shut.
   */
  notifications: defineTable({
    workspaceId: v.id("workspaces"),
    approvalId: v.optional(v.id("approvals")),
    loopId: v.optional(v.id("loops")),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_workspace_delivered", ["workspaceId", "deliveredAt"])
    .index("by_approval", ["approvalId"]),

  /** The built web app. Loomstate serves its own pages from this deployment. */
  siteAssets: defineTable({
    path: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
    updatedAt: v.number(),
  }).index("by_path", ["path"]),

  /** Domains the extension must never report. Enforced in the browser too. */
  blocklist: defineTable({
    workspaceId: v.id("workspaces"),
    pattern: v.string(),
    createdAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
});
