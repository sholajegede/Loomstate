import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sendMessage } from "./lib/agentmail";

/**
 * Loomstate runs whether or not the app is open, so a waiting approval has to
 * reach the person rather than sit on a screen nobody is looking at.
 *
 * One server event fans out to two channels: a browser notification the
 * extension raises, and an email from the agent's own inbox. Both come from the
 * moment an approval is created, so neither depends on the app being open.
 */

function appUrl(): string {
  const url = process.env.SITE_URL;
  if (url === undefined || url === "") return "";
  return url.replace(/\/+$/, "");
}

/**
 * Claims the right to announce one approval. Returns null when another run
 * already claimed it, so the person is told once and not twice.
 */
export const claimApproval = internalMutation({
  args: { approvalId: v.id("approvals") },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id("workspaces"),
      loopId: v.id("loops"),
      loopTitle: v.string(),
      agentId: v.id("agents"),
      inboxId: v.string(),
      inboxAddress: v.string(),
      ownerEmail: v.optional(v.string()),
      reason: v.string(),
      riskLevel: v.string(),
      commitsMoney: v.boolean(),
      reversible: v.boolean(),
      stepUpRequired: v.boolean(),
      subject: v.string(),
      body: v.string(),
      to: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (approval === null) return null;
    if (approval.notifiedAt !== undefined) return null;
    if (approval.status !== "pending") return null;

    await ctx.db.patch(args.approvalId, { notifiedAt: Date.now() });

    const loop = await ctx.db.get(approval.loopId);
    const agent = await ctx.db.get(approval.agentId);
    const workspace = await ctx.db.get(approval.workspaceId);
    if (agent === null || workspace === null) return null;
    const owner = await ctx.db.get(workspace.ownerId);

    const payload = (approval.editedPayload ?? approval.actionPayload) as {
      subject?: string;
      body?: string;
      to?: string[];
    };

    return {
      workspaceId: approval.workspaceId,
      loopId: approval.loopId,
      loopTitle: loop?.title ?? "a loop",
      agentId: approval.agentId,
      inboxId: agent.inboxId,
      inboxAddress: agent.inboxAddress,
      ownerEmail: owner?.email,
      reason: approval.reason,
      riskLevel: approval.riskLevel,
      commitsMoney: approval.commitsMoney,
      reversible: approval.reversible,
      stepUpRequired: approval.stepUpRequired,
      subject: payload.subject ?? "(no subject)",
      body: payload.body ?? "",
      to: payload.to ?? [],
    };
  },
});

/** Queues the browser notification the extension will raise. */
export const enqueue = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    approvalId: v.optional(v.id("approvals")),
    loopId: v.optional(v.id("loops")),
    title: v.string(),
    body: v.string(),
    url: v.string(),
  },
  returns: v.id("notifications"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      workspaceId: args.workspaceId,
      approvalId: args.approvalId,
      loopId: args.loopId,
      title: args.title,
      body: args.body,
      url: args.url,
      createdAt: Date.now(),
    });
  },
});

/** Records that Loomstate told the owner, and how. */
export const recordAnnouncement = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    approvalId: v.id("approvals"),
    detail: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      approvalId: args.approvalId,
      actorType: "system",
      action: "approval.notify",
      detail: args.detail,
      at: Date.now(),
    });
    return null;
  },
});

/** Undelivered notifications for a workspace. The extension drains these. */
export const pendingFor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(
    v.object({
      _id: v.id("notifications"),
      title: v.string(),
      body: v.string(),
      url: v.string(),
      createdAt: v.number(),
      approvalId: v.optional(v.id("approvals")),
      stepUpRequired: v.optional(v.boolean()),
      loopTitle: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_delivered", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deliveredAt", undefined),
      )
      .take(10);
    // The extension needs to know whether a notification can be answered from
    // the browser, and whether approving it needs the passkey.
    const out = [];
    for (const r of rows) {
      const approval =
        r.approvalId === undefined ? null : await ctx.db.get(r.approvalId);
      const loop = r.loopId === undefined ? null : await ctx.db.get(r.loopId);
      out.push({
        _id: r._id,
        title: r.title,
        body: r.body,
        url: r.url,
        createdAt: r.createdAt,
        approvalId:
          approval !== null && approval.status === "pending"
            ? r.approvalId
            : undefined,
        stepUpRequired: approval?.stepUpRequired,
        loopTitle: loop?.title,
      });
    }
    return out;
  },
});

export const markDelivered = internalMutation({
  args: { ids: v.array(v.id("notifications")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row !== null && row.deliveredAt === undefined) {
        await ctx.db.patch(id, { deliveredAt: now });
      }
    }
    return null;
  },
});

/**
 * Tells the owner that an action is waiting. Runs once per approval, on the
 * server, so it does not matter whether the app or the extension is open.
 */
export const announceApproval = internalAction({
  args: { approvalId: v.id("approvals") },
  returns: v.object({ notified: v.boolean(), detail: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ notified: boolean; detail: string }> => {
    const claim = await ctx.runMutation(internal.notifications.claimApproval, {
      approvalId: args.approvalId,
    });
    if (claim === null) {
      return { notified: false, detail: "This approval was already announced." };
    }

    const link = `${appUrl()}/approvals`;
    const stakes = claim.commitsMoney
      ? "It commits money."
      : !claim.reversible
        ? "It cannot be undone."
        : "It needs your decision before it goes.";

    const channels: string[] = [];

    // Channel one: the extension raises a browser notification from this.
    await ctx.runMutation(internal.notifications.enqueue, {
      workspaceId: claim.workspaceId,
      approvalId: args.approvalId,
      loopId: claim.loopId,
      title: `Approve: ${claim.loopTitle}`.slice(0, 90),
      body: `${claim.subject} ${stakes}`.slice(0, 180),
      url: link,
    });
    channels.push("a browser notification");

    // Channel two: the agent writes to the owner from its own inbox.
    const key = process.env.AGENTMAIL_API_KEY;
    if (key !== undefined && key !== "" && claim.ownerEmail !== undefined) {
      const lines = [
        `Loomstate has an action waiting for you on the loop "${claim.loopTitle}".`,
        "",
        `Why: ${claim.reason}`,
        `Stakes: ${stakes}${claim.stepUpRequired ? " It also needs a fresh passkey check." : ""}`,
        "",
        `The agent proposes to write to ${claim.to.join(", ") || "the contact on the listing"}:`,
        "",
        `Subject: ${claim.subject}`,
        "",
        claim.body,
        "",
        `Approve, edit, or reject it here: ${link}`,
        "",
        "Loomstate sends nothing on this loop until you decide.",
      ];

      try {
        await sendMessage(key, claim.inboxId, {
          to: [claim.ownerEmail],
          subject: `Approval needed: ${claim.loopTitle}`.slice(0, 120),
          text: lines.join("\n"),
        });
        channels.push("an email");
      } catch (caught) {
        console.log(
          `approval email failed: ${
            caught instanceof Error ? caught.message : "unknown"
          }`,
        );
      }
    }

    const detail = `Loomstate told the owner through ${channels.join(" and ")}.`;
    await ctx.runMutation(internal.notifications.recordAnnouncement, {
      workspaceId: claim.workspaceId,
      loopId: claim.loopId,
      approvalId: args.approvalId as Id<"approvals">,
      detail,
    });

    return { notified: true, detail };
  },
});
