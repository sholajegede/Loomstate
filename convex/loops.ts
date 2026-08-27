import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { autonomyTier, loopStatus, loopType } from "./schema";
import { requireDocIn, requireSession, requireWorkspaceWrite } from "./lib/access";
import { askForJson } from "./lib/openai";
import { alivenessScore, statusFor } from "./lib/aliveness";
import { isWatchable } from "./lib/url";
import { resolveOpenAiKey } from "./secrets";

const MAX_EVENTS_PER_RUN = 60;

const loopShape = v.object({
  _id: v.id("loops"),
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
  contactEmail: v.optional(v.string()),
  contactSource: v.optional(v.string()),
  blockedReason: v.optional(v.string()),
  lastWorkedAt: v.optional(v.number()),
  agentPausedAt: v.optional(v.number()),
  agentPauseReason: v.optional(v.string()),
});

/** Every loop in the workspace, liveliest first. The intent map reads this. */
export const list = query({
  args: {},
  returns: v.array(loopShape),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return loops
      .sort((a, b) => b.aliveness - a.aliveness)
      .map(publicLoop);
  },
});

const listItem = v.object({
  _id: v.id("loops"),
  title: v.string(),
  type: loopType,
  status: loopStatus,
  aliveness: v.number(),
  nextStep: v.string(),
  lastActivityAt: v.number(),
  blockedReason: v.optional(v.string()),
  agentPausedAt: v.optional(v.number()),
});

/**
 * A page of loops for the sidebar, including the ones that are finished. The
 * index narrows the read before anything is loaded, so the query never grows
 * with the size of the workspace.
 */
export const page = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(loopStatus),
    type: v.optional(loopType),
    minAliveness: v.optional(v.number()),
  },
  returns: v.object({
    page: v.array(listItem),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    const term = (args.search ?? "").trim();

    const result =
      term !== ""
        ? await ctx.db
            .query("loops")
            .withSearchIndex("search_title", (q) => {
              let search = q
                .search("title", term)
                .eq("workspaceId", workspace._id);
              if (args.status !== undefined) search = search.eq("status", args.status);
              if (args.type !== undefined) search = search.eq("type", args.type);
              return search;
            })
            .paginate(args.paginationOpts)
        : args.status !== undefined
          ? await ctx.db
              .query("loops")
              .withIndex("by_workspace_status", (q) =>
                q.eq("workspaceId", workspace._id).eq("status", args.status!),
              )
              .order("desc")
              .paginate(args.paginationOpts)
          : args.type !== undefined
            ? await ctx.db
                .query("loops")
                .withIndex("by_workspace_type", (q) =>
                  q.eq("workspaceId", workspace._id).eq("type", args.type!),
                )
                .order("desc")
                .paginate(args.paginationOpts)
            : await ctx.db
                .query("loops")
                .withIndex("by_workspace_activity", (q) =>
                  q.eq("workspaceId", workspace._id),
                )
                .order("desc")
                .paginate(args.paginationOpts);

    // Refinements the index could not carry are applied to the page only, so
    // the read stays bounded whatever the filters are.
    const floor = args.minAliveness ?? 0;
    const refined = result.page.filter(
      (loop) =>
        loop.aliveness >= floor &&
        (args.type === undefined || term !== "" || loop.type === args.type) &&
        (args.status === undefined || term !== "" || loop.status === args.status),
    );

    return {
      page: refined.map((loop) => ({
        _id: loop._id,
        title: loop.title,
        type: loop.type,
        status: loop.status,
        aliveness: loop.aliveness,
        nextStep: loop.nextStep,
        lastActivityAt: loop.lastActivityAt,
        blockedReason: loop.blockedReason,
        agentPausedAt: loop.agentPausedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** How many loops sit in each status. The sidebar shows these as counts. */
export const statusCounts = query({
  args: {},
  returns: v.object({
    active: v.number(),
    stalled: v.number(),
    dormant: v.number(),
    closed: v.number(),
    total: v.number(),
  }),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const counts = { active: 0, stalled: 0, dormant: 0, closed: 0, total: 0 };
    for (const status of ["active", "stalled", "dormant", "closed"] as const) {
      const rows = await ctx.db
        .query("loops")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", workspace._id).eq("status", status),
        )
        .take(200);
      counts[status] = rows.length;
      counts.total += rows.length;
    }
    return counts;
  },
});

/** One loop with everything the detail page shows. */
export const get = query({
  args: { loopId: v.id("loops") },
  returns: v.union(
    v.null(),
    v.object({
      loop: loopShape,
      events: v.array(
        v.object({
          _id: v.id("events"),
          url: v.string(),
          host: v.string(),
          title: v.string(),
          dwellMs: v.number(),
          occurredAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) return null;
    await requireDocIn(ctx, loop, "Loop");

    const events = await ctx.db
      .query("events")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(50);

    return {
      loop: publicLoop(loop),
      events: events.map((e) => ({
        _id: e._id,
        url: e.url,
        host: e.host,
        title: e.title,
        dwellMs: e.dwellMs,
        occurredAt: e.occurredAt,
      })),
    };
  },
});

/** Sets how much the agent may do on this loop. */
export const setTier = mutation({
  args: { loopId: v.id("loops"), tier: autonomyTier },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);
    await ctx.db.patch(args.loopId, { tier: args.tier });
    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      actorType: "user",
      action: "loop.setTier",
      detail: `The owner set this loop to the ${args.tier} tier.`,
      at: Date.now(),
    });
    return null;
  },
});

/**
 * Sets the contact by hand. Loomstate reads the contact off the watched page
 * on its own; this covers a page that never prints one.
 */
export const setContact = mutation({
  args: { loopId: v.id("loops"), contactEmail: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);

    const contact = args.contactEmail.trim().toLowerCase();

    // An empty value removes the contact, so the agent stops writing to it.
    if (contact === "") {
      await ctx.db.patch(args.loopId, {
        contactEmail: undefined,
        contactSource: undefined,
      });
      await ctx.db.insert("auditLog", {
        workspaceId: loop.workspaceId,
        loopId: args.loopId,
        actorType: "user",
        action: "loop.clearContact",
        detail: "The owner removed the contact for this loop.",
        at: Date.now(),
      });
      return null;
    }

    if (!contact.includes("@")) throw new Error("Enter an email address.");

    await ctx.db.patch(args.loopId, {
      contactEmail: contact,
      contactSource: "set by the owner",
      blockedReason: undefined,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      actorType: "user",
      action: "loop.setContact",
      detail: `The owner set the contact for this loop to ${contact}.`,
      at: Date.now(),
    });
    return null;
  },
});

/**
 * Clears a stop a send limit put on a loop. The owner does this after they
 * have looked at what the agent was doing.
 */
export const resumeAgent = mutation({
  args: { loopId: v.id("loops") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);

    await ctx.db.patch(args.loopId, {
      agentPausedAt: undefined,
      agentPauseReason: undefined,
      blockedReason: undefined,
      // Treat the restart as a fresh start, so the agent does not immediately
      // act on the information that led to the stop.
      lastWorkedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      actorType: "user",
      action: "loop.resumeAgent",
      detail: "The owner let the agent work this loop again.",
      at: Date.now(),
    });
    return null;
  },
});

/** Closes a loop. The agent stops working it. */
export const close = mutation({
  args: { loopId: v.id("loops") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);
    const now = Date.now();
    await ctx.db.patch(args.loopId, {
      status: "closed",
      closedAt: now,
      aliveness: 0,
    });
    for (const watch of await ctx.db
      .query("watches")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect()) {
      await ctx.db.patch(watch._id, { active: false });
    }
    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      actorType: "user",
      action: "loop.close",
      detail: "The owner closed this loop.",
      at: now,
    });
    return null;
  },
});

/**
 * Removes a loop and everything it holds: its email, approvals, grants, runs,
 * watches, snapshots, changes, notifications, and its own audit entries. The
 * browsing events survive but are detached, because the pages a person read are
 * theirs and were never the problem.
 */
export const remove = mutation({
  args: { loopId: v.id("loops") },
  returns: v.object({
    messages: v.number(),
    approvals: v.number(),
    watches: v.number(),
    snapshots: v.number(),
    diffs: v.number(),
    auditEntries: v.number(),
    eventsDetached: v.number(),
  }),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);
    return await purgeLoop(ctx, args.loopId);
  },
});

const purgeCounts = v.object({
  messages: v.number(),
  approvals: v.number(),
  watches: v.number(),
  snapshots: v.number(),
  diffs: v.number(),
  auditEntries: v.number(),
  eventsDetached: v.number(),
});

/**
 * Removes a loop without a signed-in session. Used to clear data an operator
 * must remove from a deployment they cannot open in a browser.
 */
export const purge = internalMutation({
  args: { loopId: v.id("loops") },
  returns: purgeCounts,
  handler: async (ctx, args) => {
    return await purgeLoop(ctx, args.loopId);
  },
});

type PurgeCounts = {
  messages: number;
  approvals: number;
  watches: number;
  snapshots: number;
  diffs: number;
  auditEntries: number;
  eventsDetached: number;
};

async function purgeLoop(
  ctx: MutationCtx,
  loopId: Id<"loops">,
): Promise<PurgeCounts> {
  {
    const loop = await ctx.db.get(loopId);
    if (loop === null) throw new Error("Loop not found.");
    const title = loop.title;
    const workspaceId = loop.workspaceId;
    const args = { loopId };

    const counts = {
      messages: 0,
      approvals: 0,
      watches: 0,
      snapshots: 0,
      diffs: 0,
      auditEntries: 0,
      eventsDetached: 0,
    };

    for (const message of await ctx.db
      .query("messages")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .take(500)) {
      await ctx.db.delete(message._id);
      counts.messages += 1;
    }

    for (const approval of await ctx.db
      .query("approvals")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(500)) {
      await ctx.db.delete(approval._id);
      counts.approvals += 1;
    }

    for (const grant of await ctx.db
      .query("grants")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(200)) {
      await ctx.db.delete(grant._id);
    }

    for (const run of await ctx.db
      .query("agentRuns")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .take(500)) {
      await ctx.db.delete(run._id);
    }

    for (const diff of await ctx.db
      .query("diffs")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .take(500)) {
      await ctx.db.delete(diff._id);
      counts.diffs += 1;
    }

    for (const watch of await ctx.db
      .query("watches")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(200)) {
      for (const snapshot of await ctx.db
        .query("snapshots")
        .withIndex("by_watch_time", (q) => q.eq("watchId", watch._id))
        .take(300)) {
        await ctx.db.delete(snapshot._id);
        counts.snapshots += 1;
      }
      await ctx.db.delete(watch._id);
      counts.watches += 1;
    }

    for (const agent of await ctx.db
      .query("agents")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(50)) {
      await ctx.db.delete(agent._id);
    }

    for (const entry of await ctx.db
      .query("auditLog")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .take(1000)) {
      await ctx.db.delete(entry._id);
      counts.auditEntries += 1;
    }

    for (const note of await ctx.db
      .query("notifications")
      .withIndex("by_workspace_delivered", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(500)) {
      if (note.loopId === args.loopId) await ctx.db.delete(note._id);
    }

    // The browsing signal stays. Clearing only the link keeps it out of a
    // future rebuild, so the loop does not come back.
    for (const event of await ctx.db
      .query("events")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(500)) {
      await ctx.db.patch(event._id, { loopId: undefined });
      counts.eventsDetached += 1;
    }

    await ctx.db.delete(args.loopId);

    await ctx.db.insert("auditLog", {
      workspaceId,
      actorType: "user",
      action: "loop.remove",
      detail: `The owner removed the loop "${title}" and everything it held.`,
      at: Date.now(),
    });

    return counts;
  }
}

// --- reconstruction -------------------------------------------------------

export const pendingSignal = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    events: v.array(
      v.object({
        _id: v.id("events"),
        url: v.string(),
        host: v.string(),
        title: v.string(),
        query: v.optional(v.string()),
        dwellMs: v.number(),
        occurredAt: v.number(),
      }),
    ),
    loops: v.array(
      v.object({
        _id: v.id("loops"),
        title: v.string(),
        summary: v.string(),
        keywords: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_workspace_unclustered", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("clusteredAt", undefined),
      )
      .order("desc")
      .take(MAX_EVENTS_PER_RUN);

    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return {
      events: events.map((e) => ({
        _id: e._id,
        url: e.url,
        host: e.host,
        title: e.title,
        query: e.query,
        dwellMs: e.dwellMs,
        occurredAt: e.occurredAt,
      })),
      loops: loops
        .filter((l) => l.status !== "closed")
        .map((l) => ({
          _id: l._id,
          title: l.title,
          summary: l.summary,
          keywords: l.keywords,
        })),
    };
  },
});

const clusterInput = v.object({
  existingLoopId: v.optional(v.id("loops")),
  title: v.string(),
  summary: v.string(),
  type: loopType,
  nextStep: v.string(),
  keywords: v.array(v.string()),
  momentum: v.number(),
  eventIds: v.array(v.id("events")),
});

/** Writes the model's reading of the signal into loops. */
export const applyClusters = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    clusters: v.array(clusterInput),
    skippedEventIds: v.array(v.id("events")),
  },
  returns: v.object({ created: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const workspace = await ctx.db.get(args.workspaceId);
    // Authority is a setting, not a question asked per loop. An unknown
    // workspace falls back to the safe end, not the permissive one.
    const inheritedTier = workspace?.defaultTier ?? "draft";
    let created = 0;
    let updated = 0;

    for (const cluster of args.clusters) {
      const events: Doc<"events">[] = [];
      for (const eventId of cluster.eventIds) {
        const event = await ctx.db.get(eventId);
        if (event !== null && event.workspaceId === args.workspaceId) {
          events.push(event);
        }
      }
      if (events.length === 0) continue;

      const existing =
        cluster.existingLoopId === undefined
          ? null
          : await ctx.db.get(cluster.existingLoopId);
      const isOwn = existing !== null && existing.workspaceId === args.workspaceId;

      const priorEvents = isOwn ? existing.eventCount : 0;
      const priorUrls = isOwn ? existing.sourceUrls : [];
      const lastActivityAt = Math.max(
        isOwn ? existing.lastActivityAt : 0,
        ...events.map((e) => e.occurredAt),
      );
      const totalDwellMs = events.reduce((sum, e) => sum + e.dwellMs, 0);
      const sourceUrls = [
        ...new Set([...priorUrls, ...events.map((e) => e.url)]),
      ].slice(0, 25);

      const aliveness = alivenessScore({
        lastActivityAt,
        eventCount: priorEvents + events.length,
        totalDwellMs,
        momentum: cluster.momentum,
        unseenDiffs: 0,
        now,
      });

      let loopId: Id<"loops">;
      if (isOwn) {
        loopId = existing._id;
        await ctx.db.patch(loopId, {
          title: cluster.title,
          summary: cluster.summary,
          type: cluster.type,
          nextStep: cluster.nextStep,
          keywords: cluster.keywords.slice(0, 10),
          sourceUrls,
          eventCount: priorEvents + events.length,
          lastActivityAt,
          aliveness,
          status: statusFor(aliveness, existing.status === "closed"),
        });
        updated += 1;
      } else {
        loopId = await ctx.db.insert("loops", {
          workspaceId: args.workspaceId,
          title: cluster.title,
          summary: cluster.summary,
          type: cluster.type,
          status: statusFor(aliveness, false),
          aliveness,
          nextStep: cluster.nextStep,
          sourceUrls,
          keywords: cluster.keywords.slice(0, 10),
          tier: inheritedTier,
          eventCount: events.length,
          lastActivityAt,
          createdAt: now,
        });
        created += 1;
        await ctx.db.insert("auditLog", {
          workspaceId: args.workspaceId,
          loopId,
          actorType: "system",
          action: "loop.create",
          detail: `Loomstate built the loop "${cluster.title}" from ${events.length} pages.`,
          at: now,
        });
      }

      for (const event of events) {
        await ctx.db.patch(event._id, { loopId, clusteredAt: now });
      }

      // A loop arrives ready to run. Loomstate watches the pages behind it and
      // gives it the authority the owner already chose, so nobody has to set
      // either one up by hand.
      await seedWatches(ctx, args.workspaceId, loopId, sourceUrls, now);
    }

    // Signal the model could not place still counts as read, so the next run
    // does not look at it again.
    for (const eventId of args.skippedEventIds) {
      const event = await ctx.db.get(eventId);
      if (event !== null && event.workspaceId === args.workspaceId) {
        await ctx.db.patch(eventId, { clusteredAt: now });
      }
    }

    return { created, updated };
  },
});

const SYSTEM_PROMPT = `You rebuild the goals a person is part way through from the pages they read.

A loop is one goal, not one page and not one topic. "Buy a used road bike under 800 dollars" is a loop. "Cycling" is not.

Rules:
- Group pages that serve the same goal into one loop.
- Add pages to an existing loop when they serve that same goal. Only start a new loop for a genuinely new goal.
- Ignore idle browsing: news, social feeds, video, and single pages with no goal behind them. Put those in skippedEventIds.
- Write the title as the person would say it out loud, under 60 characters.
- Write nextStep as one concrete action that moves the goal forward. Start it with the doer, for example "Ask the Jiji seller if the phone is still available." Never append a parenthetical such as "(you)".
- momentum is 0 to 1. It says how committed the person looks: repeated visits, comparison, checkout pages, and specific queries mean high momentum. One idle look means low.
- Write every field in plain, direct English. Short sentences.`;

type ClusterReply = {
  clusters: {
    existingLoopId: string | null;
    title: string;
    summary: string;
    type: "buying" | "research" | "planning" | "other";
    nextStep: string;
    keywords: string[];
    momentum: number;
    eventIds: string[];
  }[];
  skippedEventIds: string[];
};

const CLUSTER_SCHEMA = {
  name: "loop_reconstruction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clusters", "skippedEventIds"],
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "existingLoopId",
            "title",
            "summary",
            "type",
            "nextStep",
            "keywords",
            "momentum",
            "eventIds",
          ],
          properties: {
            existingLoopId: {
              type: ["string", "null"],
              description: "The id of the loop these pages belong to, or null.",
            },
            title: { type: "string" },
            summary: { type: "string" },
            type: {
              type: "string",
              enum: ["buying", "research", "planning", "other"],
            },
            nextStep: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
            momentum: { type: "number" },
            eventIds: { type: "array", items: { type: "string" } },
          },
        },
      },
      skippedEventIds: { type: "array", items: { type: "string" } },
    },
  },
};

/**
 * Reads the browsing signal that has no loop yet and rebuilds the goals behind
 * it. Safe to run repeatedly: each event is read once.
 */
const reconstructResult = v.object({
  created: v.number(),
  updated: v.number(),
  read: v.number(),
  model: v.optional(v.string()),
  detail: v.string(),
});

export type ReconstructResult = {
  created: number;
  updated: number;
  read: number;
  model?: string;
  detail: string;
};

/**
 * Rebuilds one workspace's loops. The scheduled sweep calls this, so loops
 * appear without anyone asking for them.
 */
export const reconstructFor = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: reconstructResult,
  handler: async (ctx, args): Promise<ReconstructResult> => {
    const workspaceId = args.workspaceId;
    const signal = await ctx.runQuery(internal.loops.pendingSignal, {
      workspaceId,
    });

    if (signal.events.length === 0) {
      return {
        created: 0,
        updated: 0,
        read: 0,
        detail: "No new browsing signal to read.",
      };
    }

    const apiKey = await resolveOpenAiKey(ctx, workspaceId);
    const known = new Set(signal.events.map((e) => e._id as string));
    const knownLoops = new Set(signal.loops.map((l) => l._id as string));

    const userPrompt = [
      "Existing loops:",
      signal.loops.length === 0
        ? "(none yet)"
        : signal.loops
            .map(
              (l) =>
                `- id=${l._id} | ${l.title} | ${l.summary} | keywords: ${l.keywords.join(", ")}`,
            )
            .join("\n"),
      "",
      "Pages read, newest first:",
      ...signal.events.map(
        (e) =>
          `- id=${e._id} | ${new Date(e.occurredAt).toISOString()} | ${Math.round(e.dwellMs / 1000)}s | ${e.host} | ${e.title}${e.query ? ` | searched: ${e.query}` : ""} | ${e.url}`,
      ),
    ].join("\n");

    const { value, model } = await askForJson<ClusterReply>(apiKey, {
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: CLUSTER_SCHEMA,
      reasoningEffort: "low",
    });

    const clusters = (value.clusters ?? [])
      .map((c) => ({
        existingLoopId:
          c.existingLoopId !== null && knownLoops.has(c.existingLoopId)
            ? (c.existingLoopId as Id<"loops">)
            : undefined,
        title: c.title.slice(0, 120),
        summary: c.summary.slice(0, 600),
        type: c.type,
        nextStep: c.nextStep.slice(0, 300),
        keywords: (c.keywords ?? []).slice(0, 10),
        momentum: Number.isFinite(c.momentum) ? c.momentum : 0.4,
        eventIds: (c.eventIds ?? []).filter((id) => known.has(id)) as Id<"events">[],
      }))
      .filter((c) => c.eventIds.length > 0);

    const placed = new Set(clusters.flatMap((c) => c.eventIds as string[]));
    const skippedEventIds = signal.events
      .map((e) => e._id)
      .filter((id) => !placed.has(id as string));

    const result = await ctx.runMutation(internal.loops.applyClusters, {
      workspaceId,
      clusters,
      skippedEventIds,
    });

    return {
      ...result,
      read: signal.events.length,
      model,
      detail: `Loomstate read ${signal.events.length} pages and built ${result.created} loops.`,
    };
  },
});

/**
 * Re-scans on request. Loomstate does this on its own every few minutes, so
 * this is for an owner who does not want to wait for the next sweep.
 */
export const reconstruct = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: reconstructResult,
  handler: async (ctx, args): Promise<ReconstructResult> => {
    const workspaceId = await resolveWorkspace(ctx, args.workspaceId);
    return await ctx.runAction(internal.loops.reconstructFor, { workspaceId });
  },
});

async function resolveWorkspace(
  ctx: ActionCtx,
  given: Id<"workspaces"> | undefined,
): Promise<Id<"workspaces">> {
  if (given !== undefined) return given;
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not signed in.");
  return await ctx.runQuery(internal.secrets.workspaceForCaller, {});
}

function publicLoop(loop: Doc<"loops">) {
  return {
    _id: loop._id,
    title: loop.title,
    summary: loop.summary,
    type: loop.type,
    status: loop.status,
    aliveness: loop.aliveness,
    nextStep: loop.nextStep,
    sourceUrls: loop.sourceUrls,
    keywords: loop.keywords,
    tier: loop.tier,
    eventCount: loop.eventCount,
    lastActivityAt: loop.lastActivityAt,
    createdAt: loop.createdAt,
    contactEmail: loop.contactEmail,
    contactSource: loop.contactSource,
    blockedReason: loop.blockedReason,
    lastWorkedAt: loop.lastWorkedAt,
    agentPausedAt: loop.agentPausedAt,
    agentPauseReason: loop.agentPauseReason,
  };
}

/**
 * Puts every page worth re-reading under a watch. Search pages and feeds are
 * skipped: they change for reasons the loop does not care about.
 */
async function seedWatches(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  loopId: Id<"loops">,
  sourceUrls: string[],
  now: number,
): Promise<number> {
  const existing = await ctx.db
    .query("watches")
    .withIndex("by_loop", (q) => q.eq("loopId", loopId))
    .collect();
  const already = new Set(existing.map((w) => w.url));

  let added = 0;
  for (const url of sourceUrls) {
    if (already.has(url) || !isWatchable(url)) continue;
    if (existing.length + added >= 5) break;

    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }

    await ctx.db.insert("watches", {
      workspaceId,
      loopId,
      url,
      label: host,
      intervalMinutes: 15,
      active: true,
      createdAt: now,
    });
    added += 1;
  }

  if (added > 0) {
    await ctx.db.patch(loopId, { watchesSeeded: true });
    await ctx.db.insert("auditLog", {
      workspaceId,
      loopId,
      actorType: "system",
      action: "watch.seed",
      detail: `Loomstate started watching ${added} pages behind this loop.`,
      at: now,
    });
  }
  return added;
}
