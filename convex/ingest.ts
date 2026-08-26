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
