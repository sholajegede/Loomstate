import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { evidence as evidenceValidator } from "./schema";
import { requireSession, requireWorkspaceWrite } from "./lib/access";
import { sendMessage } from "./lib/agentmail";

/**
 * A step-up confirmation only counts when the person re-authenticated in the
 * last few minutes. A stale session cannot release money.
 */
const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

const approvalShape = v.object({
  _id: v.id("approvals"),
  loopId: v.id("loops"),
  loopTitle: v.string(),
  agentAddress: v.string(),
  actionType: v.string(),
  actionPayload: v.any(),
  reason: v.string(),
  riskLevel: v.string(),
  reversible: v.boolean(),
  commitsMoney: v.boolean(),
  evidence: v.array(evidenceValidator),
  status: v.string(),
  stepUpRequired: v.boolean(),
  stepUpConfirmedAt: v.optional(v.number()),
  createdAt: v.number(),
  decidedAt: v.optional(v.number()),
});

/** Everything waiting for a decision, newest first. */
export const pending = query({
  args: {},
  returns: v.array(approvalShape),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspace._id).eq("status", "pending"),
      )
      .order("desc")
      .take(50);

    const shaped = [];
    for (const row of rows) {
      const loop = await ctx.db.get(row.loopId);
      const agent = await ctx.db.get(row.agentId);
      shaped.push({
        _id: row._id,
        loopId: row.loopId,
        loopTitle: loop?.title ?? "a loop",
        agentAddress: agent?.inboxAddress ?? "the agent",
        actionType: row.actionType,
        actionPayload: row.editedPayload ?? row.actionPayload,
        reason: row.reason,
        riskLevel: row.riskLevel,
        reversible: row.reversible,
        commitsMoney: row.commitsMoney,
        evidence: row.evidence,
        status: row.status,
        stepUpRequired: row.stepUpRequired,
        stepUpConfirmedAt: row.stepUpConfirmedAt,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt,
      });
    }
    return shaped;
  },
});

/** How many actions wait. The sidebar badge reads this. */
export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspace._id).eq("status", "pending"),
      )
      .take(100);
    return rows.length;
  },
});

/** Saves an edit the owner made to the drafted email. */
export const edit = mutation({
  args: {
    approvalId: v.id("approvals"),
    subject: v.string(),
    body: v.string(),
    to: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) throw new Error("Approval not found.");
    await requireWorkspaceWrite(ctx, approval.workspaceId);
    if (approval.status !== "pending") throw new Error("This action is decided.");

    const payload = {
      ...(approval.actionPayload as Record<string, unknown>),
      subject: args.subject,
      body: args.body,
      to: args.to,
    };
    await ctx.db.patch(args.approvalId, { editedPayload: payload });
    await ctx.db.insert("auditLog", {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      approvalId: args.approvalId,
      actorType: "user",
      action: "approval.edit",
      detail: "The owner edited the drafted email before sending.",
      at: Date.now(),
    });
    return null;
  },
});

/**
 * Records a fresh confirmation of identity. The client calls this straight
 * after the person passes the passkey check again.
 */
export const confirmStepUp = mutation({
  args: { approvalId: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) throw new Error("Approval not found.");
    const { user } = await requireWorkspaceWrite(ctx, approval.workspaceId);
    if (approval.status !== "pending") throw new Error("This action is decided.");

    const now = Date.now();
    await ctx.db.patch(args.approvalId, { stepUpConfirmedAt: now });
    await ctx.db.insert("auditLog", {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      approvalId: args.approvalId,
      actorType: "user",
      action: "approval.stepUp",
      detail: `The owner confirmed identity again for this high-stakes action.`,
      inputs: { userId: user._id },
      at: now,
    });
    return null;
  },
});

export const reject = mutation({
  args: { approvalId: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) throw new Error("Approval not found.");
    const { user } = await requireWorkspaceWrite(ctx, approval.workspaceId);
    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: "rejected",
      decidedAt: now,
      decidedBy: user._id,
    });
    await ctx.db.insert("auditLog", {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      approvalId: args.approvalId,
      actorType: "user",
      action: "approval.reject",
      detail: "The owner rejected this action.",
      at: now,
    });
    return null;
  },
});

export const readForSend = internalQuery({
  args: { approvalId: v.id("approvals") },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id("workspaces"),
      loopId: v.id("loops"),
      agentId: v.id("agents"),
      inboxId: v.string(),
      inboxAddress: v.string(),
      status: v.string(),
      stepUpRequired: v.boolean(),
      stepUpConfirmedAt: v.optional(v.number()),
      evidence: v.array(evidenceValidator),
      payload: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) return null;
    const agent = await ctx.db.get(approval.agentId);
    if (agent === null) return null;
    return {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      agentId: approval.agentId,
      inboxId: agent.inboxId,
      inboxAddress: agent.inboxAddress,
      status: approval.status,
      stepUpRequired: approval.stepUpRequired,
      stepUpConfirmedAt: approval.stepUpConfirmedAt,
      evidence: approval.evidence,
      payload: approval.editedPayload ?? approval.actionPayload,
    };
  },
});

export const markApproved = internalMutation({
  args: { approvalId: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) return null;
    const now = Date.now();
    await ctx.db.patch(args.approvalId, { status: "approved", decidedAt: now });
    await ctx.db.insert("auditLog", {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      approvalId: args.approvalId,
      actorType: "user",
      action: "approval.approve",
      detail: "The owner approved this action.",
      at: now,
    });
    return null;
  },
});

export const assertOwner = internalQuery({
  args: { approvalId: v.id("approvals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) throw new Error("Approval not found.");
    const { workspace } = await requireSession(ctx);
    if (approval.workspaceId !== workspace._id) {
      throw new Error("No access to this action.");
    }
    return null;
  },
});

/**
 * Approves an action and carries it out. The step-up gate is enforced here,
 * on the server, not in the interface.
 */
export const approveAndSend = action({
  args: { approvalId: v.id("approvals") },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; detail: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    await ctx.runQuery(internal.approvals.assertOwner, {
      approvalId: args.approvalId,
    });

    const approval = await ctx.runQuery(internal.approvals.readForSend, {
      approvalId: args.approvalId,
    });
    if (approval === null) throw new Error("Approval not found.");
    if (approval.status !== "pending") {
      return { ok: false, detail: "This action is already decided." };
    }

    if (approval.stepUpRequired) {
      const at = approval.stepUpConfirmedAt;
      if (at === undefined || Date.now() - at > STEP_UP_WINDOW_MS) {
        return {
          ok: false,
          detail:
            "This action needs a fresh identity check. Confirm with your passkey, then approve again.",
        };
      }
    }

    const payload = approval.payload as {
      to: string[];
      subject: string;
      body: string;
    };

    const key = process.env.AGENTMAIL_API_KEY;
    if (key === undefined || key === "") {
      throw new Error("AGENTMAIL_API_KEY is not set on this deployment.");
    }

    const sent = await sendMessage(key, approval.inboxId, {
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
    });

    await ctx.runMutation(internal.approvals.markApproved, {
      approvalId: args.approvalId,
    });
    await ctx.runMutation(internal.agent.recordMessage, {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      agentId: approval.agentId,
      direction: "outbound",
      threadId: sent.thread_id,
      providerMessageId: sent.message_id,
      from: approval.inboxAddress,
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      approvalId: args.approvalId as Id<"approvals">,
      evidence: approval.evidence,
    });

    return {
      ok: true,
      detail: `The agent sent the email to ${payload.to.join(", ")} from ${approval.inboxAddress}.`,
    };
  },
});
