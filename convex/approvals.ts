import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalAction,
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
      decidedVia: "web",
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
  args: {
    approvalId: v.id("approvals"),
    via: v.optional(v.union(v.literal("web"), v.literal("extension"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) return null;
    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: "approved",
      decidedAt: now,
      // Where the person actually released it, not where they typed a note.
      decidedVia: args.via ?? "web",
    });
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
/**
 * Carries out an approval that has already been authorised.
 *
 * Both ways of approving end here: the web app after its own sign-in check,
 * and a paired browser after its device check. Sharing this one body is what
 * makes the two identical, down to the audit entries they leave behind.
 *
 * The caller proves who it is. This function does not, so nothing may call it
 * without checking first.
 */
export const execute = internalAction({
  args: {
    approvalId: v.id("approvals"),
    via: v.optional(v.union(v.literal("web"), v.literal("extension"))),
  },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; detail: string }> => {
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

    // The send limit binds here too. A person approving one action at a time
    // is deliberate, but a loop that has already sent far too much is still
    // wrong to send from, however the send was started.
    const budget = await ctx.runMutation(internal.budget.checkAndReserve, {
      loopId: approval.loopId,
    });
    if (!budget.allowed) {
      return {
        ok: false,
        detail:
          budget.reason ??
          "This loop is over its send limit. Loomstate sent nothing.",
      };
    }

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
      via: args.via ?? "web",
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

/**
 * Approves an action from the web app, where the person is signed in and the
 * step-up passkey check happens.
 */
export const approveAndSend = action({
  args: { approvalId: v.id("approvals") },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (ctx, args): Promise<{ ok: boolean; detail: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    await ctx.runQuery(internal.approvals.assertOwner, {
      approvalId: args.approvalId,
    });
    return await ctx.runAction(internal.approvals.execute, {
      approvalId: args.approvalId,
      via: "web",
    });
  },
});

// --- deciding from a paired browser ---------------------------------------

/**
 * What a paired browser may see and do about the actions waiting.
 *
 * A device token is a bearer token sitting in extension storage. It is a
 * weaker credential than the passkey session the web app holds, so it gets
 * less authority: it may reject anything, and it may approve an action that
 * does not need a step-up. Releasing money or anything one-way still needs the
 * passkey, which only the app origin can ask for.
 */

const deviceApprovalShape = v.object({
  _id: v.id("approvals"),
  loopId: v.id("loops"),
  loopTitle: v.string(),
  agentAddress: v.string(),
  reason: v.string(),
  riskLevel: v.string(),
  commitsMoney: v.boolean(),
  reversible: v.boolean(),
  stepUpRequired: v.boolean(),
  subject: v.string(),
  to: v.array(v.string()),
  body: v.string(),
  createdAt: v.number(),
});

/** Pending approvals for a workspace, shaped for the extension. */
export const pendingForDevice = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(deviceApprovalShape),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .order("desc")
      .take(20);

    const out = [];
    for (const row of rows) {
      const loop = await ctx.db.get(row.loopId);
      const agent = await ctx.db.get(row.agentId);
      const payload = (row.editedPayload ?? row.actionPayload) as {
        subject?: string;
        to?: string[];
        body?: string;
      };
      out.push({
        _id: row._id,
        loopId: row.loopId,
        loopTitle: loop?.title ?? "a loop",
        agentAddress: agent?.inboxAddress ?? "the agent",
        reason: row.reason,
        riskLevel: row.riskLevel,
        commitsMoney: row.commitsMoney,
        reversible: row.reversible,
        stepUpRequired: row.stepUpRequired,
        subject: payload.subject ?? "",
        to: payload.to ?? [],
        body: (payload.body ?? "").slice(0, 1200),
        createdAt: row.createdAt,
      });
    }
    return out;
  },
});

/** Checks an approval belongs to this workspace, and reports how it is gated. */
export const gateForDevice = internalQuery({
  args: {
    approvalId: v.id("approvals"),
    workspaceId: v.id("workspaces"),
  },
  returns: v.union(
    v.null(),
    v.object({
      status: v.string(),
      stepUpRequired: v.boolean(),
      loopId: v.id("loops"),
    }),
  ),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) return null;
    if (approval.workspaceId !== args.workspaceId) return null;
    return {
      status: approval.status,
      stepUpRequired: approval.stepUpRequired,
      loopId: approval.loopId,
    };
  },
});

/**
 * Records a note the person typed. A note is not a decision: an action can be
 * annotated from the extension and then decided in the web app after a passkey
 * check, so this never claims to say where the decision was made.
 */
export const noteDecision = internalMutation({
  args: {
    approvalId: v.id("approvals"),
    note: v.string(),
    via: v.union(v.literal("web"), v.literal("extension")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) return null;
    const note = args.note.trim().slice(0, 500);
    if (note === "") return null;

    await ctx.db.patch(args.approvalId, { decisionNote: note });
    await ctx.db.insert("auditLog", {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      approvalId: args.approvalId,
      actorType: "user",
      action: "approval.note",
      detail: `The owner added a note from the ${args.via}: ${note}`,
      at: Date.now(),
    });
    return null;
  },
});

/** Rejects from a paired browser. Rejection is the safe direction, so a device may do it. */
export const rejectFromDevice = internalMutation({
  args: { approvalId: v.id("approvals"), workspaceId: v.id("workspaces") },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null || approval.workspaceId !== args.workspaceId) {
      return { ok: false, detail: "That action is not in this workspace." };
    }
    if (approval.status !== "pending") {
      return { ok: false, detail: "This action is already decided." };
    }

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: "rejected",
      decidedAt: now,
      decidedBy: (await ctx.db.get(approval.workspaceId))?.ownerId,
      decidedVia: "extension",
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
    return { ok: true, detail: "Loomstate rejected the action." };
  },
});
