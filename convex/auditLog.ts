import { v } from "convex/values";
import { query } from "./_generated/server";
import { evidence as evidenceValidator } from "./schema";
import { requireSession } from "./lib/access";

/** Every recorded action, newest first. Append-only by design. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("auditLog"),
      loopId: v.optional(v.id("loops")),
      loopTitle: v.optional(v.string()),
      agentAddress: v.optional(v.string()),
      grantTier: v.optional(v.string()),
      actorType: v.string(),
      action: v.string(),
      detail: v.string(),
      evidence: v.optional(v.array(evidenceValidator)),
      result: v.optional(v.string()),
      at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 300));

    const out = [];
    for (const row of rows) {
      const loop = row.loopId === undefined ? null : await ctx.db.get(row.loopId);
      const agent = row.agentId === undefined ? null : await ctx.db.get(row.agentId);
      const grant = row.grantId === undefined ? null : await ctx.db.get(row.grantId);
      out.push({
        _id: row._id,
        loopId: row.loopId,
        loopTitle: loop?.title,
        agentAddress: agent?.inboxAddress,
        grantTier: grant?.tier,
        actorType: row.actorType,
        action: row.action,
        detail: row.detail,
        evidence: row.evidence,
        result: row.result,
        at: row.at,
      });
    }
    return out;
  },
});
