import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { matchesPattern, parseUrl } from "./lib/url";
import type { Id } from "./_generated/dataModel";

export const eventInput = v.object({
  url: v.string(),
  title: v.string(),
  kind: v.union(
    v.literal("visit"),
    v.literal("dwell"),
    v.literal("search"),
    v.literal("manual"),
  ),
  dwellMs: v.number(),
  occurredAt: v.number(),
});

/** Resolves a device token hash to its device. Returns null when unknown. */
export const deviceByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      deviceId: v.id("devices"),
      workspaceId: v.id("workspaces"),
    }),
  ),
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (device === null || device.revokedAt !== undefined) return null;
    return { deviceId: device._id, workspaceId: device.workspaceId };
  },
});

/**
 * Loomstate's own dashboard. Reading it is not browsing a goal, and its text
 * lands in the loop the agent then writes about. A person reading their
 * NextMVP loop must not turn that loop into a loop about Loomstate.
 */
function ownHosts(): string[] {
  return [process.env.SITE_URL, process.env.CONVEX_SITE_URL]
    .flatMap((raw) => {
      if (raw === undefined || raw === "") return [];
      try {
        return [new URL(raw).hostname.replace(/^www\./, "").toLowerCase()];
      } catch {
        return [];
      }
    });
}

/**
 * Writes a batch of browsing events. The extension blocks excluded domains in
 * the browser. This second check makes sure nothing excluded is ever stored.
 */
export const recordEvents = internalMutation({
  args: {
    deviceId: v.id("devices"),
    workspaceId: v.id("workspaces"),
    events: v.array(eventInput),
  },
  returns: v.object({ accepted: v.number(), rejected: v.number() }),
  handler: async (ctx, args) => {
    const blocked = await ctx.db
      .query("blocklist")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const own = ownHosts();

    let accepted = 0;
    let rejected = 0;
    let newestAt = 0;

    for (const event of args.events) {
      const parsed = parseUrl(event.url);
      if (parsed === null) {
        rejected += 1;
        continue;
      }
      if (blocked.some((b) => matchesPattern(parsed.host, b.pattern))) {
        rejected += 1;
        continue;
      }
      if (own.includes(parsed.host)) {
        rejected += 1;
        continue;
      }

      // Merge repeat reads of the same page inside one session instead of
      // storing a new row for every tab focus.
      const sameUrl = await ctx.db
        .query("events")
        .withIndex("by_workspace_url", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("url", parsed.url),
        )
        .order("desc")
        .first();
      const recent =
        sameUrl !== null &&
        event.occurredAt - sameUrl.occurredAt < 30 * 60 * 1000 &&
        sameUrl.occurredAt - event.occurredAt < 30 * 60 * 1000
          ? sameUrl
          : null;

      if (recent !== null) {
        await ctx.db.patch(recent._id, {
          dwellMs: recent.dwellMs + Math.max(0, event.dwellMs),
          occurredAt: Math.max(recent.occurredAt, event.occurredAt),
          title: event.title.trim() === "" ? recent.title : event.title,
        });
      } else {
        await ctx.db.insert("events", {
          workspaceId: args.workspaceId,
          deviceId: args.deviceId,
          url: parsed.url,
          host: parsed.host,
          path: parsed.path,
          title: event.title.slice(0, 300),
          query: parsed.query ?? undefined,
          kind: parsed.query !== null ? "search" : event.kind,
          dwellMs: Math.max(0, event.dwellMs),
          occurredAt: event.occurredAt,
        });
      }
      accepted += 1;
      newestAt = Math.max(newestAt, event.occurredAt);
    }

    await ctx.db.patch(args.deviceId, { lastSeenAt: Date.now() });
    return { accepted, rejected };
  },
});

/** Counts pending approvals and active loops for the extension popup. */
export const popupState = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ activeLoops: v.number(), pendingApprovals: v.number() }),
  handler: async (ctx, args) => {
    const workspaceId: Id<"workspaces"> = args.workspaceId;
    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "active"),
      )
      .collect();
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "pending"),
      )
      .collect();
    return { activeLoops: loops.length, pendingApprovals: approvals.length };
  },
});

/**
 * Records what the extension says about itself.
 *
 * A notification the browser accepts and the operating system then hides looks
 * like a success from the server, so the only way to know is to have the
 * browser report what it saw.
 */
export const recordHealth = internalMutation({
  args: {
    deviceId: v.id("devices"),
    health: v.object({
      version: v.optional(v.string()),
      permission: v.optional(v.string()),
      alarmInSeconds: v.optional(v.number()),
      lastPullAt: v.optional(v.number()),
      lastPullCount: v.optional(v.number()),
      lastRaisedAt: v.optional(v.number()),
      lastRaisedCount: v.optional(v.number()),
      lastError: v.optional(v.string()),
      lastTestAt: v.optional(v.number()),
      lastTestError: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.deviceId, {
      health: args.health,
      healthAt: Date.now(),
    });
    return null;
  },
});

/**
 * Clears signal Loomstate captured about itself before it stopped doing so.
 * A loop built partly from the dashboard reads as a loop about Loomstate, and
 * the agent then writes about Loomstate rather than about the goal. Safe to
 * run more than once.
 */
export const dropOwnHostSignal = internalMutation({
  args: {},
  returns: v.object({
    events: v.number(),
    loops: v.number(),
    watches: v.number(),
    diffs: v.number(),
  }),
  handler: async (ctx) => {
    const own = ownHosts();
    if (own.length === 0) return { events: 0, loops: 0, watches: 0, diffs: 0 };

    const hostOf = (raw: string): string | null => {
      try {
        return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        return null;
      }
    };

    let removedEvents = 0;
    for (const event of await ctx.db.query("events").take(2000)) {
      if (!own.includes(event.host)) continue;
      await ctx.db.delete(event._id);
      removedEvents += 1;
    }

    let touchedLoops = 0;
    for (const loop of await ctx.db.query("loops").take(500)) {
      const kept = loop.sourceUrls.filter((raw) => {
        const host = hostOf(raw);
        return host === null || !own.includes(host);
      });
      if (kept.length === loop.sourceUrls.length) continue;
      await ctx.db.patch(loop._id, { sourceUrls: kept });
      touchedLoops += 1;
    }

    let removedWatches = 0;
    for (const watch of await ctx.db.query("watches").take(500)) {
      const host = hostOf(watch.url);
      if (host === null || !own.includes(host)) continue;
      await ctx.db.delete(watch._id);
      removedWatches += 1;
    }

    // A change found on a page that is gone is still read as evidence, and it
    // is the freshest thing the agent sees. It goes with the watch.
    let removedDiffs = 0;
    for (const diff of await ctx.db.query("diffs").take(2000)) {
      if ((await ctx.db.get(diff.watchId)) !== null) continue;
      await ctx.db.delete(diff._id);
      removedDiffs += 1;
    }

    return {
      events: removedEvents,
      loops: touchedLoops,
      watches: removedWatches,
      diffs: removedDiffs,
    };
  },
});
