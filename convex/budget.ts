import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * A hard cap on outbound email, independent of every other check.
 *
 * The dedupe and step-state rules stop the agent repeating itself. This exists
 * for the case where they do not: a bug, a strange reply pattern, a loop nobody
 * predicted. It counts real sends and stops the agent before it can burn
 * credits or fill somebody's inbox, then hands the loop to a human.
 */

export const LOOP_HOURLY_CAP = 3;
export const LOOP_DAILY_CAP = 8;
export const WORKSPACE_HOURLY_CAP = 8;

function siteUrl(): string {
  return (process.env.SITE_URL ?? "").replace(/\/+$/, "");
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Decides whether one more send is allowed, and pauses the loop or the
 * workspace when it is not. Called immediately before every send.
 */
export const checkAndReserve = internalMutation({
  args: { loopId: v.id("loops") },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    pausedLoop: v.boolean(),
    pausedWorkspace: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) {
      return {
        allowed: false,
        reason: "Loop not found.",
        pausedLoop: false,
        pausedWorkspace: false,
      };
    }

    const now = Date.now();

    if (loop.agentPausedAt !== undefined) {
      return {
        allowed: false,
        reason: loop.agentPauseReason ?? "This loop is paused for review.",
        pausedLoop: true,
        pausedWorkspace: false,
      };
    }

    const recentOnLoop = await ctx.db
      .query("messages")
      .withIndex("by_loop_time", (q) =>
        q.eq("loopId", args.loopId).gte("sentAt", now - DAY_MS),
      )
      .collect();
    const outboundDay = recentOnLoop.filter((m) => m.direction === "outbound");
    const outboundHour = outboundDay.filter((m) => m.sentAt >= now - HOUR_MS);

    if (outboundHour.length >= LOOP_HOURLY_CAP) {
      return await pauseLoop(
        ctx,
        args.loopId,
        `Loomstate stopped this loop. The agent sent ${outboundHour.length} emails in an hour, which is over the limit of ${LOOP_HOURLY_CAP}.`,
      );
    }

    if (outboundDay.length >= LOOP_DAILY_CAP) {
      return await pauseLoop(
        ctx,
        args.loopId,
        `Loomstate stopped this loop. The agent sent ${outboundDay.length} emails in a day, which is over the limit of ${LOOP_DAILY_CAP}.`,
      );
    }

    const recentInWorkspace = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (q) =>
        q.eq("workspaceId", loop.workspaceId).gte("sentAt", now - HOUR_MS),
      )
      .collect();
    const workspaceHour = recentInWorkspace.filter(
      (m) => m.direction === "outbound",
    );

    if (workspaceHour.length >= WORKSPACE_HOURLY_CAP) {
      const reason = `Loomstate paused every loop. The agent sent ${workspaceHour.length} emails in an hour across this workspace, which is over the limit of ${WORKSPACE_HOURLY_CAP}.`;
      await ctx.db.patch(loop.workspaceId, { autopilot: false });
      await ctx.db.insert("auditLog", {
        workspaceId: loop.workspaceId,
        loopId: args.loopId,
        actorType: "system",
        action: "budget.pauseWorkspace",
        detail: reason,
        at: now,
      });
      await ctx.db.insert("notifications", {
        workspaceId: loop.workspaceId,
        loopId: args.loopId,
        title: "Loomstate paused itself",
        body: reason,
        url: `${siteUrl()}/settings`,
        createdAt: now,
      });
      return {
        allowed: false,
        reason,
        pausedLoop: false,
        pausedWorkspace: true,
      };
    }

    return { allowed: true, pausedLoop: false, pausedWorkspace: false };
  },
});

async function pauseLoop(
  ctx: MutationCtx,
  loopId: Id<"loops">,
  reason: string,
): Promise<{
  allowed: boolean;
  reason: string;
  pausedLoop: boolean;
  pausedWorkspace: boolean;
}> {
  const now = Date.now();
  const loop = await ctx.db.get(loopId);
  if (loop === null) {
    return { allowed: false, reason, pausedLoop: false, pausedWorkspace: false };
  }

  await ctx.db.patch(loopId, {
    agentPausedAt: now,
    agentPauseReason: reason,
    blockedReason: reason,
  });
  await ctx.db.insert("auditLog", {
    workspaceId: loop.workspaceId,
    loopId,
    actorType: "system",
    action: "budget.pauseLoop",
    detail: reason,
    at: now,
  });
  await ctx.db.insert("notifications", {
    workspaceId: loop.workspaceId,
    loopId,
    title: "Loomstate stopped a loop",
    body: reason,
    url: `${siteUrl()}/loops/${loopId}`,
    createdAt: now,
  });

  return { allowed: false, reason, pausedLoop: true, pausedWorkspace: false };
}

/** Clears a pause once a human has looked at it. */
export const resumeLoop = internalMutation({
  args: { loopId: v.id("loops") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) return null;
    await ctx.db.patch(args.loopId, {
      agentPausedAt: undefined,
      agentPauseReason: undefined,
      blockedReason: undefined,
    });
    return null;
  },
});
