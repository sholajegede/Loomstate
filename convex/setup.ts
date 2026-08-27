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
    pairedBrowsers: v.number(),
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

    return {
      hasKey,
      pairedBrowsers: live.length,
      browserReporting: live.some((d) => d.lastSeenAt !== undefined),
      defaultTier: workspace.defaultTier ?? "draft",
      hasSignal: signal.length > 0,
      doneAt: workspace.setupDoneAt,
      skippedAt: workspace.setupSkippedAt,
      showOnArrival:
        workspace.setupDoneAt === undefined &&
        workspace.setupSkippedAt === undefined,
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
