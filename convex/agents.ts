import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireDocIn, requireSession } from "./lib/access";
import { createInbox, listInboxes } from "./lib/agentmail";

function agentMailKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (key === undefined || key === "") {
    throw new Error("AGENTMAIL_API_KEY is not set on this deployment.");
  }
  return key;
}

/** A short, readable inbox name derived from the loop title. */
function usernameFor(title: string, salt: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `loom-${slug === "" ? "agent" : slug}-${salt.slice(-6)}`;
}

export const agentForLoop = internalQuery({
  args: { loopId: v.id("loops") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("agents"),
      inboxId: v.string(),
      inboxAddress: v.string(),
      name: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .first();
    if (agent === null) return null;
    return {
      _id: agent._id,
      inboxId: agent.inboxId,
      inboxAddress: agent.inboxAddress,
      name: agent.name,
    };
  },
});

/** The agent on a loop, for the loop detail page. */
export const forLoop = query({
  args: { loopId: v.id("loops") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("agents"),
      name: v.string(),
      inboxAddress: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    await requireDocIn(ctx, loop, "Loop");
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .first();
    if (agent === null) return null;
    return {
      _id: agent._id,
      name: agent.name,
      inboxAddress: agent.inboxAddress,
      createdAt: agent.createdAt,
    };
  },
});

export const storeAgent = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    name: v.string(),
    inboxId: v.string(),
    inboxAddress: v.string(),
  },
  returns: v.id("agents"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .first();
    if (existing !== null) return existing._id;

    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      name: args.name,
      inboxId: args.inboxId,
      inboxAddress: args.inboxAddress,
      createdAt: now,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId,
      actorType: "system",
      action: "agent.create",
      detail: `Loomstate gave this loop the agent address ${args.inboxAddress}.`,
      at: now,
    });
    return agentId;
  },
});

/** Gives a loop its own agent inbox. Safe to call repeatedly. */
export const ensureForLoop = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    loopTitle: v.string(),
  },
  returns: v.object({
    agentId: v.id("agents"),
    inboxId: v.string(),
    inboxAddress: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    agentId: Id<"agents">;
    inboxId: string;
    inboxAddress: string;
  }> => {
    const existing = await ctx.runQuery(internal.agents.agentForLoop, {
      loopId: args.loopId,
    });
    if (existing !== null) {
      return {
        agentId: existing._id,
        inboxId: existing.inboxId,
        inboxAddress: existing.inboxAddress,
      };
    }

    // Loomstate prefers one inbox per loop. Some AgentMail credentials are
    // scoped to a single inbox and cannot create more. In that case the agent
    // uses the inbox the credential already owns instead of failing.
    const key = agentMailKey();
    let inbox;
    try {
      inbox = await createInbox(key, {
        username: usernameFor(args.loopTitle, args.loopId),
        displayName: `Loomstate agent for ${args.loopTitle}`.slice(0, 80),
      });
    } catch (caught) {
      const existing = await listInboxes(key);
      if (existing.length === 0) {
        throw new Error(
          `Loomstate cannot create an agent inbox and found none to use. ${
            caught instanceof Error ? caught.message : ""
          }`.slice(0, 400),
        );
      }
      inbox = existing[0];
    }

    const agentId: Id<"agents"> = await ctx.runMutation(
      internal.agents.storeAgent,
      {
        workspaceId: args.workspaceId,
        loopId: args.loopId,
        name: `Agent for ${args.loopTitle}`.slice(0, 90),
        inboxId: inbox.inbox_id,
        inboxAddress: inbox.email,
      },
    );

    return { agentId, inboxId: inbox.inbox_id, inboxAddress: inbox.email };
  },
});

export const inboxOwner = internalQuery({
  args: { inboxId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      agentId: v.id("agents"),
      workspaceId: v.id("workspaces"),
      loopId: v.id("loops"),
      inboxAddress: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("agents").take(500);
    const agent = agents.find((a) => a.inboxId === args.inboxId);
    if (agent === undefined || agent.loopId === undefined) return null;
    return {
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      loopId: agent.loopId,
      inboxAddress: agent.inboxAddress,
    };
  },
});

/** Every agent in the workspace, for the settings and audit views. */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("agents"),
      name: v.string(),
      inboxAddress: v.string(),
      loopId: v.optional(v.id("loops")),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return agents.map((a) => ({
      _id: a._id,
      name: a.name,
      inboxAddress: a.inboxAddress,
      loopId: a.loopId,
      createdAt: a.createdAt,
    }));
  },
});
