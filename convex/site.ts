import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Loomstate serves its own web app from this deployment, so the product and its
 * backend share one origin. A publish uploads the built files here, and the
 * HTTP router reads them back.
 */

export const readAsset = internalQuery({
  args: { path: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.id("_storage"),
      contentType: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db
      .query("siteAssets")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .unique();
    if (asset === null) return null;
    return { storageId: asset.storageId, contentType: asset.contentType };
  },
});

export const putAsset = internalMutation({
  args: {
    path: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("siteAssets")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .unique();

    if (existing !== null) {
      // Drop the file the old row pointed at, so a republish frees its space.
      await ctx.storage.delete(existing.storageId);
      await ctx.db.replace(existing._id, {
        path: args.path,
        storageId: args.storageId,
        contentType: args.contentType,
        size: args.size,
        updatedAt: Date.now(),
      });
      return null;
    }

    await ctx.db.insert("siteAssets", {
      path: args.path,
      storageId: args.storageId,
      contentType: args.contentType,
      size: args.size,
      updatedAt: Date.now(),
    });
    return null;
  },
});
