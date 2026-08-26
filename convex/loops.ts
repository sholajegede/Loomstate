import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { autonomyTier, loopStatus, loopType } from "./schema";
import { requireDocIn, requireSession, requireWorkspaceWrite } from "./lib/access";
import { askForJson } from "./lib/openai";
import { alivenessScore, statusFor } from "./lib/aliveness";
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
          tier: "watch",
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
- Write nextStep as the one concrete action that moves the goal forward. Name the doer.
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
export const reconstruct = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    read: v.number(),
    model: v.optional(v.string()),
    detail: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    created: number;
    updated: number;
    read: number;
    model?: string;
    detail: string;
  }> => {
    const workspaceId = await resolveWorkspace(ctx, args.workspaceId);
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
  };
}
