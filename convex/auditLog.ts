import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { evidence as evidenceValidator } from "./schema";
import { requireSession } from "./lib/access";

const entryShape = v.object({
  _id: v.id("auditLog"),
  loopId: v.optional(v.id("loops")),
  loopTitle: v.optional(v.string()),
  agentId: v.optional(v.id("agents")),
  agentAddress: v.optional(v.string()),
  grantTier: v.optional(v.string()),
  grantActions: v.optional(v.array(v.string())),
  grantExpiresAt: v.optional(v.number()),
  approvalId: v.optional(v.id("approvals")),
  actorType: v.string(),
  action: v.string(),
  detail: v.string(),
  evidence: v.optional(v.array(evidenceValidator)),
  result: v.optional(v.string()),
  at: v.number(),
});

/** Every recorded action, newest first. Append-only by design. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(entryShape),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 300));

    const out = [];
    for (const row of rows) out.push(await decorate(ctx, row));
    return out;
  },
});

/**
 * A page of the audit log under one lens.
 *
 * With an agentId it reads one agent's own history through that agent's index.
 * Without one it reads the workspace as a whole. Either way the index narrows
 * the read first, so the query does not grow with the size of the log.
 */
export const page = query({
  args: {
    paginationOpts: paginationOptsValidator,
    agentId: v.optional(v.id("agents")),
    loopId: v.optional(v.id("loops")),
    action: v.optional(v.string()),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
  },
  returns: v.object({
    page: v.array(entryShape),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);

    const result =
      args.agentId !== undefined
        ? await ctx.db
            .query("auditLog")
            .withIndex("by_agent_time", (q) =>
              withTime(q.eq("agentId", args.agentId), args.since, args.until),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : args.loopId !== undefined
          ? await ctx.db
              .query("auditLog")
              .withIndex("by_loop_time", (q) =>
                withTime(q.eq("loopId", args.loopId), args.since, args.until),
              )
              .order("desc")
              .paginate(args.paginationOpts)
          : await ctx.db
              .query("auditLog")
              .withIndex("by_workspace_time", (q) =>
                withTime(q.eq("workspaceId", workspace._id), args.since, args.until),
              )
              .order("desc")
              .paginate(args.paginationOpts);

    // An entry read through the agent or loop index still has to belong to the
    // caller's workspace.
    const mine = result.page.filter(
      (row) =>
        row.workspaceId === workspace._id &&
        (args.action === undefined || row.action === args.action),
    );

    const decorated = [];
    for (const row of mine) decorated.push(await decorate(ctx, row));

    return {
      page: decorated,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** The action names present in this workspace, for the filter list. */
export const actionKinds = query({
  args: {},
  returns: v.array(v.object({ action: v.string(), count: v.number() })),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(500);

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);
  },
});

/** Each agent with how much it has done. The per-agent lens reads this. */
export const agentSummaries = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("agents"),
      name: v.string(),
      inboxAddress: v.string(),
      loopId: v.optional(v.id("loops")),
      loopTitle: v.optional(v.string()),
      actions: v.number(),
      lastActionAt: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(100);

    const out = [];
    for (const agent of agents) {
      const rows = await ctx.db
        .query("auditLog")
        .withIndex("by_agent_time", (q) => q.eq("agentId", agent._id))
        .order("desc")
        .take(200);
      const loop =
        agent.loopId === undefined ? null : await ctx.db.get(agent.loopId);
      out.push({
        _id: agent._id,
        name: agent.name,
        inboxAddress: agent.inboxAddress,
        loopId: agent.loopId,
        loopTitle: loop?.title,
        actions: rows.length,
        lastActionAt: rows.length === 0 ? null : rows[0].at,
      });
    }
    return out.sort((a, b) => (b.lastActionAt ?? 0) - (a.lastActionAt ?? 0));
  },
});

/**
 * Narrows an index range to a time window. The builder has to be chained in
 * one expression, so each combination is spelled out.
 */
function withTime(base: any, since?: number, until?: number) {
  if (since !== undefined && until !== undefined) {
    return base.gte("at", since).lte("at", until);
  }
  if (since !== undefined) return base.gte("at", since);
  if (until !== undefined) return base.lte("at", until);
  return base;
}

/** Attaches the provenance already recorded against an entry. */
async function decorate(ctx: QueryCtx, row: Doc<"auditLog">) {
  const loop = row.loopId === undefined ? null : await ctx.db.get(row.loopId);
  const agent = row.agentId === undefined ? null : await ctx.db.get(row.agentId);
  const grant = row.grantId === undefined ? null : await ctx.db.get(row.grantId);
  return {
    _id: row._id,
    loopId: row.loopId,
    loopTitle: loop?.title,
    agentId: row.agentId,
    agentAddress: agent?.inboxAddress,
    grantTier: grant?.tier,
    grantActions: grant?.allowedActions,
    grantExpiresAt: grant?.expiresAt,
    approvalId: row.approvalId,
    actorType: row.actorType,
    action: row.action,
    detail: row.detail,
    evidence: row.evidence,
    result: row.result,
    at: row.at,
  };
}
