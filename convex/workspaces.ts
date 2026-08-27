import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getOwnedWorkspace,
  getUser,
  requireSession,
  requireUser,
  requireWorkspaceWrite,
} from "./lib/access";
import { autonomyTier } from "./schema";

const DEFAULT_BLOCKED = [
  "*.bank",
  "*banking*",
  "chase.com",
  "wellsfargo.com",
  "paypal.com",
  "*.health",
  "mychart.*",
  "patient.*",
];

/** The signed-in user and their workspace. Returns null when signed out. */
export const current = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      user: v.object({
        _id: v.id("users"),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        image: v.optional(v.string()),
      }),
      workspace: v.union(
        v.null(),
        v.object({
          _id: v.id("workspaces"),
          name: v.string(),
          createdAt: v.number(),
          defaultTier: v.string(),
          autopilot: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (user === null) return null;
    const workspace = await getOwnedWorkspace(ctx, user);
    return {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      workspace:
        workspace === null
          ? null
          : {
              _id: workspace._id,
              name: workspace.name,
              createdAt: workspace.createdAt,
              defaultTier: workspace.defaultTier ?? "act",
              autopilot: workspace.autopilot !== false,
            },
    };
  },
});

/**
 * Creates the caller's workspace on first sign-in. Safe to call repeatedly:
 * a user owns at most one workspace.
 */
export const ensure = mutation({
  args: {},
  returns: v.id("workspaces"),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existing = await getOwnedWorkspace(ctx, user);
    if (existing !== null) return existing._id;

    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: user.email ? `${user.email.split("@")[0]}'s loom` : "My loom",
      ownerId: user._id,
      createdAt: now,
      // Loomstate acts on low-stakes email by itself from the start. Anything
      // that commits money still waits for approval, whatever this says.
      defaultTier: "act",
      autopilot: true,
    });
    await ctx.db.patch(user._id, { defaultWorkspaceId: workspaceId });

    for (const pattern of DEFAULT_BLOCKED) {
      await ctx.db.insert("blocklist", {
        workspaceId,
        pattern,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditLog", {
      workspaceId,
      actorType: "user",
      action: "workspace.create",
      detail: "The owner created this workspace.",
      at: now,
    });
    return workspaceId;
  },
});

/**
 * Sets the authority every new loop inherits. The owner chooses this once.
 * The step-up gate on money and one-way actions is not affected by it.
 */
export const setDefaults = mutation({
  args: {
    defaultTier: v.optional(autonomyTier),
    autopilot: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);

    const patch: { defaultTier?: "watch" | "draft" | "act"; autopilot?: boolean } = {};
    if (args.defaultTier !== undefined) patch.defaultTier = args.defaultTier;
    if (args.autopilot !== undefined) patch.autopilot = args.autopilot;
    if (Object.keys(patch).length === 0) return null;

    await ctx.db.patch(workspace._id, patch);
    await ctx.db.insert("auditLog", {
      workspaceId: workspace._id,
      actorType: "user",
      action: "workspace.setDefaults",
      detail:
        args.autopilot === false
          ? "The owner paused the agent across this workspace."
          : `The owner set the standing authority to ${args.defaultTier ?? workspace.defaultTier ?? "act"}.`,
      at: Date.now(),
    });
    return null;
  },
});
