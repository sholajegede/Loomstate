import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSession, requireWorkspaceWrite } from "./lib/access";

export const list = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("blocklist"), pattern: v.string() })),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("blocklist")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return rows.map((r) => ({ _id: r._id, pattern: r.pattern }));
  },
});

export const add = mutation({
  args: { pattern: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    const pattern = args.pattern.trim().toLowerCase();
    if (pattern === "") throw new Error("Enter a domain.");
    await ctx.db.insert("blocklist", {
      workspaceId: workspace._id,
      pattern,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("blocklist") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row === null) return null;
    await requireWorkspaceWrite(ctx, row.workspaceId);
    await ctx.db.delete(args.id);
    return null;
  },
});
