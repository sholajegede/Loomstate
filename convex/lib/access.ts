import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Returns the signed-in user, or null. Never throws. */
export async function getUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

/** Returns the signed-in user, or throws. Use in every non-public function. */
export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getUser(ctx);
  if (user === null) throw new Error("Not signed in.");
  return user;
}

/** The workspace this user owns. Read paths only; never creates. */
export async function getOwnedWorkspace(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<Doc<"workspaces"> | null> {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .first();
}

export type Session = {
  user: Doc<"users">;
  workspace: Doc<"workspaces">;
};

/**
 * The signed-in user together with the workspace they may act in.
 * Throws when either is missing, so callers never guess an id.
 */
export async function requireSession(ctx: QueryCtx): Promise<Session> {
  const user = await requireUser(ctx);
  const workspace = await getOwnedWorkspace(ctx, user);
  if (workspace === null) throw new Error("No workspace for this user.");
  return { user, workspace };
}

/** Throws unless the caller may read the workspace. Owners and viewers may. */
export async function requireWorkspaceRead(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"workspaces">> {
  const user = await requireUser(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (workspace === null) throw new Error("Workspace not found.");
  if (workspace.ownerId === user._id) return workspace;

  const viewer = await ctx.db
    .query("viewers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .filter((q) => q.eq(q.field("userId"), user._id))
    .first();
  if (viewer === null) throw new Error("No access to this workspace.");
  return workspace;
}

/** Throws unless the caller owns the workspace. Every write path uses this. */
export async function requireWorkspaceWrite(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<{ user: Doc<"users">; workspace: Doc<"workspaces"> }> {
  const user = await requireUser(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (workspace === null) throw new Error("Workspace not found.");
  if (workspace.ownerId !== user._id) throw new Error("Not the workspace owner.");
  return { user, workspace };
}

/** Loads a document and checks it belongs to a workspace the caller can read. */
export async function requireDocIn<
  T extends { workspaceId: Id<"workspaces"> },
>(ctx: QueryCtx, doc: T | null, name: string): Promise<T> {
  if (doc === null) throw new Error(`${name} not found.`);
  await requireWorkspaceRead(ctx, doc.workspaceId);
  return doc;
}
