import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { autonomyTier } from "./schema";
import { requireDocIn, requireSession, requireWorkspaceWrite } from "./lib/access";

/** What an agent may be allowed to do. Anything absent is refused. */
export const ACTIONS = [
  "email.ask", // ask a question, commit nothing
  "email.negotiate", // propose terms, still no commitment
  "email.commit", // agree to buy or book. Always needs approval.
] as const;

const DEFAULT_HOURS = 72;

const grantShape = v.object({
  _id: v.id("grants"),
  loopId: v.id("loops"),
  agentId: v.id("agents"),
  tier: autonomyTier,
  allowedActions: v.array(v.string()),
  spendCapCents: v.number(),
  grantedAt: v.number(),
  expiresAt: v.number(),
  revokedAt: v.optional(v.number()),
  active: v.boolean(),
});

function isActive(grant: {
  expiresAt: number;
  revokedAt?: number;
}): boolean {
  return grant.revokedAt === undefined && grant.expiresAt > Date.now();
}

/** The grants on one loop. The loop page shows these. */
export const forLoop = query({
  args: { loopId: v.id("loops") },
  returns: v.array(grantShape),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    await requireDocIn(ctx, loop, "Loop");
    const grants = await ctx.db
      .query("grants")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect();
    return grants.map((g) => ({
      _id: g._id,
      loopId: g.loopId,
      agentId: g.agentId,
      tier: g.tier,
      allowedActions: g.allowedActions,
      spendCapCents: g.spendCapCents,
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
      revokedAt: g.revokedAt,
      active: isActive(g),
    }));
  },
});

/**
 * The live grant for a loop, or null. Every agent action reads this first.
 * A grant that expired or was revoked is not live, whatever the tier says.
 */
export const activeForLoop = internalQuery({
  args: { loopId: v.id("loops") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("grants"),
      agentId: v.id("agents"),
      tier: autonomyTier,
      allowedActions: v.array(v.string()),
      spendCapCents: v.number(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const grants = await ctx.db
      .query("grants")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect();
    const live = grants.filter(isActive).sort((a, b) => b.grantedAt - a.grantedAt)[0];
    if (live === undefined) return null;
    return {
      _id: live._id,
      agentId: live.agentId,
      tier: live.tier,
      allowedActions: live.allowedActions,
      spendCapCents: live.spendCapCents,
      expiresAt: live.expiresAt,
    };
  },
});

/**
 * Materialises the grant a loop already inherited. The owner chooses authority
 * once, in settings; Loomstate writes the record so the agent can act without
 * anyone filling in a form per loop.
 */
export const ensureAuto = internalMutation({
  args: { loopId: v.id("loops"), agentId: v.id("agents") },
  returns: v.union(v.null(), v.id("grants")),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) return null;

    const grants = await ctx.db
      .query("grants")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect();
    if (grants.some(isActive)) return null;

    const workspace = await ctx.db.get(loop.workspaceId);
    if (workspace === null) return null;

    const now = Date.now();
    const grantId = await ctx.db.insert("grants", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      tier: loop.tier,
      // Never email.commit. Money always routes to the approval queue.
      allowedActions:
        loop.tier === "watch" ? [] : ["email.ask", "email.negotiate"],
      spendCapCents: 0,
      grantedBy: workspace.ownerId,
      grantedAt: now,
      expiresAt: now + DEFAULT_HOURS * 3_600_000,
    });

    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      grantId,
      actorType: "system",
      action: "grant.auto",
      detail: `Loomstate applied the owner's standing ${loop.tier} authority to this loop.`,
      at: now,
    });
    return grantId;
  },
});

/** Gives an agent authority on a loop. The grant expires by default. */
export const grant = mutation({
  args: {
    loopId: v.id("loops"),
    agentId: v.id("agents"),
    tier: autonomyTier,
    allowedActions: v.optional(v.array(v.string())),
    spendCapCents: v.optional(v.number()),
    hours: v.optional(v.number()),
  },
  returns: v.id("grants"),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    const { user } = await requireWorkspaceWrite(ctx, loop.workspaceId);

    const agent = await ctx.db.get(args.agentId);
    if (agent === null || agent.workspaceId !== loop.workspaceId) {
      throw new Error("Agent not found in this workspace.");
    }

    // Revoke any earlier grant so a loop has exactly one live authority.
    const now = Date.now();
    for (const old of await ctx.db
      .query("grants")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect()) {
      if (isActive(old)) await ctx.db.patch(old._id, { revokedAt: now });
    }

    const allowed =
      args.allowedActions ??
      (args.tier === "act"
        ? ["email.ask", "email.negotiate"]
        : args.tier === "draft"
          ? ["email.ask", "email.negotiate"]
          : []);

    const grantId = await ctx.db.insert("grants", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      tier: args.tier,
      // An agent never holds email.commit. Money always goes to the queue.
      allowedActions: allowed.filter((a) => a !== "email.commit"),
      spendCapCents: args.spendCapCents ?? 0,
      grantedBy: user._id,
      grantedAt: now,
      expiresAt: now + (args.hours ?? DEFAULT_HOURS) * 3_600_000,
    });

    await ctx.db.patch(args.loopId, { tier: args.tier });
    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      grantId,
      actorType: "user",
      action: "grant.create",
      detail: `The owner gave the agent ${args.tier} authority until ${new Date(
        now + (args.hours ?? DEFAULT_HOURS) * 3_600_000,
      ).toISOString()}.`,
      at: now,
    });
    return grantId;
  },
});

/** Takes authority away at once. */
export const revoke = mutation({
  args: { grantId: v.id("grants") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (grant === null) throw new Error("Grant not found.");
    await requireWorkspaceWrite(ctx, grant.workspaceId);
    const now = Date.now();
    await ctx.db.patch(args.grantId, { revokedAt: now });
    await ctx.db.patch(grant.loopId, { tier: "watch" });
    await ctx.db.insert("auditLog", {
      workspaceId: grant.workspaceId,
      loopId: grant.loopId,
      agentId: grant.agentId,
      grantId: args.grantId,
      actorType: "user",
      action: "grant.revoke",
      detail: "The owner revoked the agent's authority on this loop.",
      at: now,
    });
    return null;
  },
});

/** Every grant in the workspace, newest first. */
export const list = query({
  args: {},
  returns: v.array(grantShape),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const grants = await ctx.db
      .query("grants")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return grants
      .sort((a, b) => b.grantedAt - a.grantedAt)
      .map((g) => ({
        _id: g._id,
        loopId: g.loopId,
        agentId: g.agentId,
        tier: g.tier,
        allowedActions: g.allowedActions,
        spendCapCents: g.spendCapCents,
        grantedAt: g.grantedAt,
        expiresAt: g.expiresAt,
        revokedAt: g.revokedAt,
        active: isActive(g),
      }));
  },
});
