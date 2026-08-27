import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { autonomyTier } from "./schema";
import { requireSession, requireWorkspaceWrite } from "./lib/access";
import {
  CAP_LIMITS,
  LOOP_DAILY_CAP,
  LOOP_HOURLY_CAP,
  WORKSPACE_HOURLY_CAP,
  clampCap,
} from "./budget";
import { DEFAULT_CHAT_MODEL, DEFAULT_EFFORT } from "./lib/models";

/**
 * Everything the settings screen reads and writes.
 *
 * Every function here resolves the caller's own workspace through the session.
 * None of them accept a workspace or user id from the client, so a caller can
 * only ever read and change what is theirs. Where a mutation does take an id,
 * such as a loop, it loads that record and checks the workspace on it before
 * touching anything.
 */

const effort = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

/** The whole settings surface in one authorized read. */
export const overview = query({
  args: {},
  returns: v.object({
    profile: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      workspaceName: v.string(),
      memberSince: v.number(),
      agentAddresses: v.array(v.string()),
    }),
    autonomy: v.object({
      defaultTier: autonomyTier,
      autopilot: v.boolean(),
    }),
    caps: v.object({
      loopHourly: v.number(),
      loopDaily: v.number(),
      workspaceHourly: v.number(),
      usingDefaults: v.boolean(),
      limits: v.object({
        loopHourly: v.object({ min: v.number(), max: v.number() }),
        loopDaily: v.object({ min: v.number(), max: v.number() }),
        workspaceHourly: v.object({ min: v.number(), max: v.number() }),
      }),
    }),
    notifications: v.object({
      email: v.boolean(),
      browser: v.boolean(),
      inboundConnected: v.boolean(),
    }),
    keys: v.object({
      model: v.string(),
      effort,
      stored: v.array(
        v.object({
          provider: v.string(),
          hint: v.string(),
          updatedAt: v.number(),
        }),
      ),
    }),
    loopOverrides: v.array(
      v.object({
        _id: v.id("loops"),
        title: v.string(),
        status: v.string(),
        tier: autonomyTier,
        overridden: v.boolean(),
        grantTier: v.optional(autonomyTier),
        grantExpiresAt: v.optional(v.number()),
        paused: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { user, workspace } = await requireSession(ctx);
    const defaultTier = workspace.defaultTier ?? "draft";

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(20);

    const secrets = await ctx.db
      .query("secrets")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id),
      )
      .collect();

    // Newest activity first, so the loops a person recognises are on top.
    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace_activity", (q) =>
        q.eq("workspaceId", workspace._id),
      )
      .order("desc")
      .take(25);

    const overrides = [];
    for (const loop of loops) {
      if (loop.status === "closed") continue;
      const grants = await ctx.db
        .query("grants")
        .withIndex("by_loop", (q) => q.eq("loopId", loop._id))
        .take(10);
      const live = grants.find(
        (g) => g.revokedAt === undefined && g.expiresAt > Date.now(),
      );
      overrides.push({
        _id: loop._id,
        title: loop.title,
        status: loop.status,
        tier: loop.tier,
        overridden: loop.tier !== defaultTier,
        grantTier: live?.tier,
        grantExpiresAt: live?.expiresAt,
        paused: loop.agentPausedAt !== undefined,
      });
    }

    return {
      profile: {
        name: user.name,
        email: user.email,
        workspaceName: workspace.name,
        memberSince: workspace.createdAt,
        agentAddresses: [...new Set(agents.map((a) => a.inboxAddress))],
      },
      autonomy: {
        defaultTier,
        autopilot: workspace.autopilot !== false,
      },
      caps: {
        loopHourly: workspace.sendCapLoopHourly ?? LOOP_HOURLY_CAP,
        loopDaily: workspace.sendCapLoopDaily ?? LOOP_DAILY_CAP,
        workspaceHourly:
          workspace.sendCapWorkspaceHourly ?? WORKSPACE_HOURLY_CAP,
        usingDefaults:
          workspace.sendCapLoopHourly === undefined &&
          workspace.sendCapLoopDaily === undefined &&
          workspace.sendCapWorkspaceHourly === undefined,
        limits: {
          loopHourly: { ...CAP_LIMITS.loopHourly },
          loopDaily: { ...CAP_LIMITS.loopDaily },
          workspaceHourly: { ...CAP_LIMITS.workspaceHourly },
        },
      },
      notifications: {
        email: workspace.notifyEmail !== false,
        browser: workspace.notifyBrowser !== false,
        inboundConnected: secrets.some(
          (s) => s.provider === "agentmail_webhook",
        ),
      },
      keys: {
        model: workspace.chatModel ?? DEFAULT_CHAT_MODEL,
        effort: workspace.chatEffort ?? DEFAULT_EFFORT,
        stored: secrets
          .filter((s) => s.provider !== "agentmail_webhook")
          .map((s) => ({
            provider: s.provider,
            hint: s.hint,
            updatedAt: s.updatedAt,
          })),
      },
      loopOverrides: overrides,
    };
  },
});

/** Renames the person and their workspace. */
export const saveProfile = mutation({
  args: {
    name: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);

    if (args.name !== undefined) {
      const name = args.name.trim().slice(0, 80);
      await ctx.db.patch(user._id, { name: name === "" ? undefined : name });
    }
    if (args.workspaceName !== undefined) {
      const name = args.workspaceName.trim().slice(0, 80);
      if (name !== "") await ctx.db.patch(workspace._id, { name });
    }
    return null;
  },
});

/**
 * Sets the send backstop. The values are clamped to what Loomstate will
 * honour, so the limit can be loosened but never removed.
 */
export const saveCaps = mutation({
  args: {
    loopHourly: v.optional(v.number()),
    loopDaily: v.optional(v.number()),
    workspaceHourly: v.optional(v.number()),
  },
  returns: v.object({
    loopHourly: v.number(),
    loopDaily: v.number(),
    workspaceHourly: v.number(),
  }),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);

    const loopHourly = clampCap(
      args.loopHourly ?? workspace.sendCapLoopHourly ?? LOOP_HOURLY_CAP,
      CAP_LIMITS.loopHourly,
    );
    const loopDaily = clampCap(
      args.loopDaily ?? workspace.sendCapLoopDaily ?? LOOP_DAILY_CAP,
      CAP_LIMITS.loopDaily,
    );
    const workspaceHourly = clampCap(
      args.workspaceHourly ??
        workspace.sendCapWorkspaceHourly ??
        WORKSPACE_HOURLY_CAP,
      CAP_LIMITS.workspaceHourly,
    );

    await ctx.db.patch(workspace._id, {
      sendCapLoopHourly: loopHourly,
      sendCapLoopDaily: loopDaily,
      sendCapWorkspaceHourly: workspaceHourly,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: workspace._id,
      actorType: "user",
      action: "workspace.setSendCaps",
      detail: `The owner set the send limits to ${loopHourly} an hour and ${loopDaily} a day for one loop, and ${workspaceHourly} an hour across the workspace.`,
      at: Date.now(),
    });
    return { loopHourly, loopDaily, workspaceHourly };
  },
});

/** Puts the send backstop back to the built-in limits. */
export const resetCaps = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);
    await ctx.db.patch(workspace._id, {
      sendCapLoopHourly: undefined,
      sendCapLoopDaily: undefined,
      sendCapWorkspaceHourly: undefined,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: workspace._id,
      actorType: "user",
      action: "workspace.resetSendCaps",
      detail: "The owner put the send limits back to the built-in ones.",
      at: Date.now(),
    });
    return null;
  },
});

/** Chooses which channels an approval reaches the owner through. */
export const saveNotifications = mutation({
  args: {
    email: v.optional(v.boolean()),
    browser: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);

    const patch: { notifyEmail?: boolean; notifyBrowser?: boolean } = {};
    if (args.email !== undefined) patch.notifyEmail = args.email;
    if (args.browser !== undefined) patch.notifyBrowser = args.browser;
    if (Object.keys(patch).length === 0) return null;

    await ctx.db.patch(workspace._id, patch);

    const email = patch.notifyEmail ?? workspace.notifyEmail !== false;
    const browser = patch.notifyBrowser ?? workspace.notifyBrowser !== false;
    await ctx.db.insert("auditLog", {
      workspaceId: workspace._id,
      actorType: "user",
      action: "workspace.setNotifications",
      detail:
        !email && !browser
          ? "The owner turned off every notification channel. An action still waits in the approval queue, but Loomstate does not announce it."
          : `The owner set approval notices to reach them through ${[
              email ? "email" : null,
              browser ? "the browser" : null,
            ]
              .filter(Boolean)
              .join(" and ")}.`,
      at: Date.now(),
    });
    return null;
  },
});
