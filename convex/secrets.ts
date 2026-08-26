import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptSecret, encryptSecret, keyHint } from "./lib/crypto";
import { requireSession, requireWorkspaceWrite } from "./lib/access";
import type { Id } from "./_generated/dataModel";

const provider = v.union(v.literal("openai"), v.literal("firecrawl"));

/** Which keys the workspace holds. The key itself is never returned. */
export const status = query({
  args: {},
  returns: v.array(
    v.object({
      provider: v.string(),
      hint: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return rows.map((r) => ({
      provider: r.provider,
      hint: r.hint,
      updatedAt: r.updatedAt,
    }));
  },
});

export const workspaceForCaller = internalQuery({
  args: {},
  returns: v.id("workspaces"),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    return workspace._id;
  },
});

export const put = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    provider,
    ciphertext: v.string(),
    iv: v.string(),
    hint: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .unique();

    const row = {
      workspaceId: args.workspaceId,
      provider: args.provider,
      ciphertext: args.ciphertext,
      iv: args.iv,
      hint: args.hint,
      updatedAt: Date.now(),
    };
    if (existing === null) {
      await ctx.db.insert("secrets", row);
    } else {
      await ctx.db.replace(existing._id, row);
    }
    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      actorType: "user",
      action: "secret.save",
      detail: `The owner saved a ${args.provider} key.`,
      at: Date.now(),
    });
    return null;
  },
});

/** Reads a stored key for server-side use. Never expose this to the client. */
export const read = internalQuery({
  args: { workspaceId: v.id("workspaces"), provider },
  returns: v.union(v.null(), v.object({ ciphertext: v.string(), iv: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .unique();
    if (row === null) return null;
    return { ciphertext: row.ciphertext, iv: row.iv };
  },
});

/**
 * Saves a key the user brings. Loomstate checks the key against the provider
 * before it stores anything, so a wrong key fails here and not later.
 */
export const save = action({
  args: { provider, key: v.string() },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (ctx, args): Promise<{ ok: boolean; detail: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const key = args.key.trim();
    if (key === "") throw new Error("Enter a key.");

    const check = await verifyKey(args.provider, key);
    if (!check.ok) return check;

    const workspaceId: Id<"workspaces"> = await ctx.runQuery(
      internal.secrets.workspaceForCaller,
      {},
    );
    const sealed = await encryptSecret(key);
    await ctx.runMutation(internal.secrets.put, {
      workspaceId,
      provider: args.provider,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      hint: keyHint(key),
    });
    return check;
  },
});

export const forget = mutation({
  args: { provider },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", args.provider),
      )
      .unique();
    if (row !== null) await ctx.db.delete(row._id);
    return null;
  },
});

async function verifyKey(
  name: "openai" | "firecrawl",
  key: string,
): Promise<{ ok: boolean; detail: string }> {
  if (name === "openai") {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      return { ok: false, detail: "OpenAI rejected this key." };
    }
    return { ok: true, detail: "Loomstate checked this key against OpenAI." };
  }

  const response = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    return { ok: false, detail: "Firecrawl rejected this key." };
  }
  return { ok: true, detail: "Loomstate checked this key against Firecrawl." };
}

/** Returns the OpenAI key for a workspace, or throws with a clear message. */
export async function resolveOpenAiKey(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
): Promise<string> {
  const stored = await ctx.runQuery(internal.secrets.read, {
    workspaceId,
    provider: "openai" as const,
  });
  if (stored !== null) {
    return await decryptSecret(stored.ciphertext, stored.iv);
  }
  const fallback = process.env.OPENAI_API_KEY;
  if (fallback !== undefined && fallback !== "") return fallback;
  throw new Error("Add your OpenAI key in Settings first.");
}

/** Returns the Firecrawl key. The deployment key is the default for everyone. */
export async function resolveFirecrawlKey(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
): Promise<string> {
  const fallback = process.env.FIRECRAWL_API_KEY;
  if (fallback !== undefined && fallback !== "") return fallback;
  const stored = await ctx.runQuery(internal.secrets.read, {
    workspaceId,
    provider: "firecrawl" as const,
  });
  if (stored !== null) {
    return await decryptSecret(stored.ciphertext, stored.iv);
  }
  throw new Error("Add a Firecrawl key in Settings first.");
}
