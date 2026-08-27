import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Loomstate runs on its own. These sweeps rebuild loops from new browsing
 * signal and work the loops that have something new to act on, whether or not
 * anyone has the app open.
 */

const WORK_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_WORKSPACES_PER_SWEEP = 20;
const MAX_LOOPS_PER_SWEEP = 5;

/** Workspaces holding browsing signal that no loop covers yet. */
export const workspacesWithNewSignal = internalQuery({
  args: {},
  returns: v.array(v.id("workspaces")),
  handler: async (ctx) => {
    const workspaces = await ctx.db.query("workspaces").take(200);
    const withSignal: Id<"workspaces">[] = [];

    for (const workspace of workspaces) {
      if (workspace.autopilot === false) continue;
      const pending = await ctx.db
        .query("events")
        .withIndex("by_workspace_unclustered", (q) =>
          q.eq("workspaceId", workspace._id).eq("clusteredAt", undefined),
        )
        .take(1);
      if (pending.length > 0) withSignal.push(workspace._id);
      if (withSignal.length >= MAX_WORKSPACES_PER_SWEEP) break;
    }
    return withSignal;
  },
});

/** Rebuilds loops for every workspace with new signal. */
export const reconstructAll = internalAction({
  args: {},
  returns: v.object({ workspaces: v.number(), created: v.number() }),
  handler: async (ctx): Promise<{ workspaces: number; created: number }> => {
    const workspaceIds = await ctx.runQuery(
      internal.autopilot.workspacesWithNewSignal,
      {},
    );

    let created = 0;
    for (const workspaceId of workspaceIds) {
      try {
        const result = await ctx.runAction(internal.autopilot.reconstructOne, {
          workspaceId,
        });
        created += result.created;
      } catch (caught) {
        // A workspace without a key must not stop the others.
        console.log(
          `reconstruct skipped ${workspaceId}: ${
            caught instanceof Error ? caught.message : "unknown"
          }`,
        );
      }
    }

    console.log(
      `reconstruct: read ${workspaceIds.length} workspaces, built ${created} loops`,
    );
    return { workspaces: workspaceIds.length, created };
  },
});

export const reconstructOne = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ created: v.number() }),
  handler: async (ctx, args): Promise<{ created: number }> => {
    const result = await ctx.runAction(internal.loops.reconstructFor, {
      workspaceId: args.workspaceId,
    });
    return { created: result.created };
  },
});

/** Loops that have something new for the agent to act on. */
export const loopsReadyForWork = internalQuery({
  args: {},
  returns: v.array(v.id("loops")),
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("loops")
      .withIndex("by_status_worked", (q) => q.eq("status", "active"))
      .take(100);

    const ready: Id<"loops">[] = [];
    for (const loop of active) {
      if (loop.tier === "watch") continue;
      if (
        loop.lastWorkedAt !== undefined &&
        now - loop.lastWorkedAt < WORK_COOLDOWN_MS
      ) {
        continue;
      }

      const workspace = await ctx.db.get(loop.workspaceId);
      if (workspace?.autopilot === false) continue;

      // Something new means an unread change on the live web, an unanswered
      // reply, or a loop the agent has never looked at.
      const diffs = await ctx.db
        .query("diffs")
        .withIndex("by_loop_time", (q) => q.eq("loopId", loop._id))
        .order("desc")
        .take(10);
      const unseenChange = diffs.some(
        (d) => d.seenAt === undefined && d.kind !== "first_seen",
      );

      const lastMessage = await ctx.db
        .query("messages")
        .withIndex("by_loop_time", (q) => q.eq("loopId", loop._id))
        .order("desc")
        .first();
      const awaitingAnswer =
        lastMessage !== null && lastMessage.direction === "inbound";

      const neverWorked = loop.lastWorkedAt === undefined;

      if (unseenChange || awaitingAnswer || neverWorked) ready.push(loop._id);
      if (ready.length >= MAX_LOOPS_PER_SWEEP) break;
    }
    return ready;
  },
});

/** Works every loop that has something new. */
export const workDueLoops = internalAction({
  args: {},
  returns: v.object({ worked: v.number() }),
  handler: async (ctx): Promise<{ worked: number }> => {
    const loopIds = await ctx.runQuery(internal.autopilot.loopsReadyForWork, {});

    for (const loopId of loopIds) {
      // Pace the sweep whatever the outcome, so one stuck loop cannot be
      // retried every fifteen minutes.
      await ctx.runMutation(internal.agent.markWorked, { loopId });
      try {
        await ctx.runAction(internal.agent.workLoop, {
          loopId,
          trigger: "schedule",
        });
      } catch (caught) {
        console.log(
          `work skipped ${loopId}: ${
            caught instanceof Error ? caught.message : "unknown"
          }`,
        );
      }
    }

    console.log(`work: worked ${loopIds.length} loops`);
    return { worked: loopIds.length };
  },
});
