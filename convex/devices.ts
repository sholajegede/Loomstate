import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { randomToken, sha256Hex } from "./lib/hash";
import { requireSession, requireWorkspaceWrite } from "./lib/access";
import type { Id } from "./_generated/dataModel";

/** Browsers paired to the caller's workspace. */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("devices"),
      label: v.string(),
      createdAt: v.number(),
      lastSeenAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return devices.map((d) => ({
      _id: d._id,
      label: d.label,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
    }));
  },
});

/** Reads the caller's workspace id for the pairing action. */
export const myWorkspaceIdInternal = internalQuery({
  args: {},
  returns: v.id("workspaces"),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    return workspace._id;
  },
});

export const store = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    label: v.string(),
    tokenHash: v.string(),
  },
  returns: v.id("devices"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const deviceId = await ctx.db.insert("devices", {
      workspaceId: args.workspaceId,
      label: args.label,
      tokenHash: args.tokenHash,
      createdAt: now,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      actorType: "user",
      action: "device.pair",
      detail: `The owner paired the browser "${args.label}".`,
      at: now,
    });
    return deviceId;
  },
});

/**
 * Pairs a browser. Returns the token once. Loomstate stores only its hash,
 * so the token cannot be read back later.
 */
export const pair = action({
  args: { label: v.string() },
  returns: v.object({ deviceId: v.id("devices"), token: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ deviceId: Id<"devices">; token: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const workspaceId: Id<"workspaces"> = await ctx.runQuery(
      internal.devices.myWorkspaceIdInternal,
      {},
    );
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const deviceId: Id<"devices"> = await ctx.runMutation(internal.devices.store, {
      workspaceId,
      label: args.label.trim() === "" ? "This browser" : args.label.trim(),
      tokenHash,
    });
    return { deviceId, token };
  },
});

/** Stops a paired browser. The extension is rejected from the next event on. */
export const revoke = mutation({
  args: { deviceId: v.id("devices") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (device === null) throw new Error("Device not found.");
    await requireWorkspaceWrite(ctx, device.workspaceId);
    const now = Date.now();
    await ctx.db.patch(args.deviceId, { revokedAt: now });
    await ctx.db.insert("auditLog", {
      workspaceId: device.workspaceId,
      actorType: "user",
      action: "device.revoke",
      detail: `The owner stopped the browser "${device.label}".`,
      at: now,
    });
    return null;
  },
});
