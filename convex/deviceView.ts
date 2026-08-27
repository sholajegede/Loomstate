import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { matchesPattern, parseUrl, isWatchable } from "./lib/url";
import type { Id } from "./_generated/dataModel";

/**
 * What a paired browser shows.
 *
 * The extension is a glanceable surface, so this returns one bounded page of
 * each thing rather than everything. Every read goes through an index and is
 * capped, and the loop list is paginated so a large workspace does not make the
 * popup slow. The full history stays in the web app.
 */

const LOOPS_PER_PAGE = 8;
const ACTIVITY_LIMIT = 6;

const loopShape = v.object({
  _id: v.id("loops"),
  title: v.string(),
  status: v.string(),
  type: v.string(),
  aliveness: v.number(),
  nextStep: v.string(),
  lastActivityAt: v.number(),
  blocked: v.optional(v.string()),
  paused: v.boolean(),
});

const activityShape = v.object({
  actorType: v.string(),
  action: v.string(),
  detail: v.string(),
  loopTitle: v.optional(v.string()),
  at: v.number(),
});

/** Everything the popup needs, in one read. */
export const overview = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    paused: v.boolean(),
    defaultTier: v.string(),
    counts: v.object({
      activeLoops: v.number(),
      pendingApprovals: v.number(),
    }),
    loops: v.object({
      page: v.array(loopShape),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
    activity: v.array(activityShape),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);

    const active = await ctx.db
      .query("loops")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "active"),
      )
      .take(100);

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .take(50);

    // Most recently active first, so what the person is working on is on top.
    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace_activity", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const rawActivity = await ctx.db
      .query("auditLog")
      .withIndex("by_workspace_time", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(ACTIVITY_LIMIT);

    const activity = [];
    for (const entry of rawActivity) {
      const loop =
        entry.loopId === undefined ? null : await ctx.db.get(entry.loopId);
      activity.push({
        actorType: entry.actorType,
        action: entry.action,
        detail: entry.detail.slice(0, 200),
        loopTitle: loop?.title,
        at: entry.at,
      });
    }

    return {
      paused: workspace?.autopilot === false,
      defaultTier: workspace?.defaultTier ?? "draft",
      counts: {
        activeLoops: active.length,
        pendingApprovals: approvals.length,
      },
      loops: {
        page: loops.page.map((loop) => ({
          _id: loop._id,
          title: loop.title,
          status: loop.status,
          type: loop.type,
          aliveness: loop.aliveness,
          nextStep: loop.nextStep.slice(0, 160),
          lastActivityAt: loop.lastActivityAt,
          blocked: loop.blockedReason,
          paused: loop.agentPausedAt !== undefined,
        })),
        isDone: loops.isDone,
        continueCursor: loops.continueCursor,
      },
      activity,
    };
  },
});

/** Loop names for the quick-add list. Bounded, newest activity first. */
export const loopChoices = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.object({ _id: v.id("loops"), title: v.string() })),
  handler: async (ctx, args) => {
    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace_activity", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(15);
    return loops
      .filter((l) => l.status !== "closed")
      .map((l) => ({ _id: l._id, title: l.title }));
  },
});

/**
 * Puts the page the person is looking at onto a loop, either an existing one or
 * a new one they name. This is the person filing something by hand, so the page
 * is stored and watched the same way captured browsing would be.
 *
 * The block list still applies. A page the owner told Loomstate never to read
 * is not stored because they pressed a button on it.
 */
export const capture = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.id("devices"),
    url: v.string(),
    title: v.string(),
    loopId: v.optional(v.id("loops")),
    newLoopTitle: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    detail: v.string(),
    loopId: v.optional(v.id("loops")),
    watched: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const parsed = parseUrl(args.url);
    if (parsed === null) {
      return { ok: false, detail: "Loomstate can only add a web page.", watched: false };
    }

    const blocked = await ctx.db
      .query("blocklist")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    if (blocked.some((b) => matchesPattern(parsed.host, b.pattern))) {
      return {
        ok: false,
        detail: `${parsed.host} is on your excluded list, so Loomstate did not store it.`,
        watched: false,
      };
    }

    const now = Date.now();
    let loopId: Id<"loops">;
    let created = false;

    if (args.loopId !== undefined) {
      const loop = await ctx.db.get(args.loopId);
      if (loop === null || loop.workspaceId !== args.workspaceId) {
        return { ok: false, detail: "That loop is not in this workspace.", watched: false };
      }
      loopId = loop._id;
      await ctx.db.patch(loopId, {
        lastActivityAt: now,
        lastSignalAt: now,
        eventCount: loop.eventCount + 1,
        sourceUrls: [...new Set([...loop.sourceUrls, parsed.url])].slice(0, 25),
      });
    } else {
      const workspace = await ctx.db.get(args.workspaceId);
      const title = (args.newLoopTitle ?? args.title ?? parsed.host).trim();
      loopId = await ctx.db.insert("loops", {
        workspaceId: args.workspaceId,
        title: (title === "" ? parsed.host : title).slice(0, 120),
        summary: `The owner added this loop from ${parsed.host}.`,
        type: "other",
        status: "active",
        // A loop the person filed by hand is live by definition.
        aliveness: 70,
        nextStep: "Loomstate watches this page and reports what changes.",
        sourceUrls: [parsed.url],
        keywords: [],
        tier: workspace?.defaultTier ?? "draft",
        eventCount: 1,
        lastActivityAt: now,
        lastSignalAt: now,
        createdAt: now,
      });
      created = true;
    }

    await ctx.db.insert("events", {
      workspaceId: args.workspaceId,
      deviceId: args.deviceId,
      url: parsed.url,
      host: parsed.host,
      path: parsed.path,
      title: args.title.slice(0, 300),
      query: parsed.query ?? undefined,
      kind: "manual",
      dwellMs: 0,
      occurredAt: now,
      loopId,
      clusteredAt: now,
    });

    // Watch it too, unless it is the kind of page that changes for reasons the
    // loop does not care about.
    let watched = false;
    if (isWatchable(parsed.url)) {
      const existing = await ctx.db
        .query("watches")
        .withIndex("by_loop_url", (q) =>
          q.eq("loopId", loopId).eq("url", parsed.url),
        )
        .first();
      if (existing === null) {
        await ctx.db.insert("watches", {
          workspaceId: args.workspaceId,
          loopId,
          url: parsed.url,
          label: parsed.host,
          intervalMinutes: 15,
          active: true,
          createdAt: now,
        });
        watched = true;
      }
    }

    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      loopId,
      actorType: "user",
      action: created ? "loop.addFromBrowser" : "loop.attachPage",
      detail: created
        ? `The owner started this loop from ${parsed.host} in the browser.`
        : `The owner added ${parsed.url} to this loop from the browser.`,
      at: now,
    });

    return {
      ok: true,
      detail: created
        ? `Loomstate started a loop and ${watched ? "watches" : "stored"} this page.`
        : `Loomstate added this page to the loop${watched ? " and watches it" : ""}.`,
      loopId,
      watched,
    };
  },
});
