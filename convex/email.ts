import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireDocIn, requireSession } from "./lib/access";
import { createWebhook } from "./lib/agentmail";
import { encryptSecret, decryptSecret } from "./lib/crypto";
import type { ActionCtx } from "./_generated/server";

const SITE_URL = () => {
  const url = process.env.CONVEX_SITE_URL;
  if (url === undefined || url === "") {
    throw new Error("CONVEX_SITE_URL is not available.");
  }
  return url;
};

/** Whether replies can reach Loomstate yet. */
export const inboundStatus = query({
  args: {},
  returns: v.object({ connected: v.boolean(), updatedAt: v.optional(v.number()) }),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", "agentmail_webhook"),
      )
      .unique();
    return { connected: row !== null, updatedAt: row?.updatedAt };
  },
});

/**
 * Tells AgentMail to post every reply to this deployment. Loomstate keeps the
 * signing secret encrypted, so it can prove a delivery really came from
 * AgentMail before it acts on one.
 */
export const connectReplies = action({
  args: {},
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (ctx): Promise<{ ok: boolean; detail: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const key = process.env.AGENTMAIL_API_KEY;
    if (key === undefined || key === "") {
      throw new Error("AGENTMAIL_API_KEY is not set on this deployment.");
    }

    const workspaceId: Id<"workspaces"> = await ctx.runQuery(
      internal.secrets.workspaceForCaller,
      {},
    );

    const hook = await createWebhook(key, {
      url: `${SITE_URL()}/x/agentmail`,
    });

    const sealed = await encryptSecret(hook.secret);
    await ctx.runMutation(internal.secrets.put, {
      workspaceId,
      provider: "agentmail_webhook",
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      hint: `...${hook.webhook_id.slice(-6)}`,
    });

    return {
      ok: true,
      detail: "AgentMail now posts every reply to Loomstate.",
    };
  },
});

/** The agent thread on one loop. The loop page shows this. */
export const threadForLoop = query({
  args: { loopId: v.id("loops") },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      direction: v.string(),
      from: v.string(),
      to: v.array(v.string()),
      subject: v.string(),
      body: v.string(),
      sentAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    await requireDocIn(ctx, loop, "Loop");
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(30);
    return messages.reverse().map((m) => ({
      _id: m._id,
      direction: m.direction,
      from: m.from,
      to: m.to,
      subject: m.subject,
      body: m.body,
      sentAt: m.sentAt,
    }));
  },
});

export const webhookSecretFor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.null(), v.object({ ciphertext: v.string(), iv: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", "agentmail_webhook"),
      )
      .unique();
    if (row === null) return null;
    return { ciphertext: row.ciphertext, iv: row.iv };
  },
});

/** Reads the signing secret a workspace stored, or null. */
export async function resolveWebhookSecret(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
): Promise<string | null> {
  const stored = await ctx.runQuery(internal.email.webhookSecretFor, {
    workspaceId,
  });
  if (stored === null) {
    const fallback = process.env.AGENTMAIL_WEBHOOK_SECRET;
    return fallback === undefined || fallback === "" ? null : fallback;
  }
  return await decryptSecret(stored.ciphertext, stored.iv);
}
