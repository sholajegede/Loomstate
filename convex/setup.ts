import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSession, requireWorkspaceWrite } from "./lib/access";

/**
 * First-run setup.
 *
 * Loomstate cannot rebuild a loop without a key, and it sees nothing without a
 * paired browser, so a new account that lands straight in the app finds a
 * screen that quietly does nothing. This walks the owner through the three
 * things that make it work.
 *
 * Each step reports the real state rather than whether a button was pressed,
 * so leaving halfway and coming back shows exactly what is still missing.
 */

/** Where the owner has got to. Every step is derived from what exists. */
export const status = query({
  args: {},
  returns: v.object({
    hasKey: v.boolean(),
    // A browser that has actually connected. Minting a token is not pairing:
    // the extension may not even be installed yet.
    pairedBrowsers: v.number(),
    // Tokens created that no extension has used yet.
    tokensWaiting: v.number(),
    browserReporting: v.boolean(),
    defaultTier: v.string(),
    hasSignal: v.boolean(),
    doneAt: v.optional(v.number()),
    skippedAt: v.optional(v.number()),
    // True when Loomstate should open setup rather than the app.
    showOnArrival: v.boolean(),
    // True when nothing can work yet, so the app explains instead of sitting empty.
    blocked: v.boolean(),
  }),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);

    const secrets = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", "openai"),
      )
      .unique();

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(20);
    const live = devices.filter((d) => d.revokedAt === undefined);

    const signal = await ctx.db
      .query("events")
      .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspace._id))
      .take(1);

    const hasKey = secrets !== null;
    // Pairing means an extension reached Loomstate. A device row exists from
    // the moment a token is made, and a token nobody has used pairs nothing.
    const connected = live.filter((d) => d.lastSeenAt !== undefined);
    const alreadyWorking = hasKey && connected.length > 0;

    return {
      hasKey,
      pairedBrowsers: connected.length,
      tokensWaiting: live.length - connected.length,
      browserReporting: connected.length > 0,
      defaultTier: workspace.defaultTier ?? "draft",
      hasSignal: signal.length > 0,
      doneAt: workspace.setupDoneAt,
      skippedAt: workspace.setupSkippedAt,
      showOnArrival:
        workspace.setupDoneAt === undefined &&
        workspace.setupSkippedAt === undefined &&
        !alreadyWorking,
      blocked: !hasKey,
    };
  },
});

/** Marks setup finished. It does not reappear on its own after this. */
export const complete = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);
    if (workspace.setupDoneAt !== undefined) return null;

    const now = Date.now();
    await ctx.db.patch(workspace._id, {
      setupDoneAt: now,
      setupSkippedAt: undefined,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: workspace._id,
      actorType: "user",
      action: "workspace.setupComplete",
      detail: "The owner finished setting Loomstate up.",
      at: now,
    });
    return null;
  },
});

/** Puts setup aside. The owner can open it again whenever they want. */
export const skip = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);
    if (workspace.setupDoneAt !== undefined) return null;
    await ctx.db.patch(workspace._id, { setupSkippedAt: Date.now() });
    return null;
  },
});
