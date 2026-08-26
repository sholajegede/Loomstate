import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOwnedWorkspace, getUser, requireUser } from "./lib/access";

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
