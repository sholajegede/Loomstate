import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireSession } from "./lib/access";

const eventShape = v.object({
  _id: v.id("events"),
  url: v.string(),
  host: v.string(),
  title: v.string(),
  query: v.optional(v.string()),
  kind: v.string(),
  dwellMs: v.number(),
  occurredAt: v.number(),
  loopId: v.optional(v.id("loops")),
});

/** The newest browsing events. The Signal page subscribes to this. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(eventShape),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    const limit = Math.min(args.limit ?? 60, 200);
    const events = await ctx.db
      .query("events")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(limit);
    return events.map((e) => ({
      _id: e._id,
      url: e.url,
      host: e.host,
      title: e.title,
      query: e.query,
      kind: e.kind,
      dwellMs: e.dwellMs,
      occurredAt: e.occurredAt,
      loopId: e.loopId,
    }));
  },
});

/** Counts used by the header strip. */
export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    unclustered: v.number(),
    hosts: v.number(),
    lastAt: v.union(v.null(), v.number()),
  }),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const events = await ctx.db
      .query("events")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(500);
    return {
      total: events.length,
      unclustered: events.filter((e) => e.loopId === undefined).length,
      hosts: new Set(events.map((e) => e.host)).size,
      lastAt: events.length === 0 ? null : events[0].occurredAt,
    };
  },
});
