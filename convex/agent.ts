import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireDocIn } from "./lib/access";
import { askForJson } from "./lib/openai";
import { sendMessage } from "./lib/agentmail";
import { resolveOpenAiKey } from "./secrets";
import { isResend, stepKeyOf } from "./lib/similarity";

const evidenceValidator = v.object({
  watchId: v.optional(v.id("watches")),
  diffId: v.optional(v.id("diffs")),
  url: v.string(),
  label: v.string(),
  before: v.optional(v.string()),
  after: v.optional(v.string()),
  observedAt: v.number(),
});

// --- what the agent reads before it decides -------------------------------

export const loopBrief = internalQuery({
  args: { loopId: v.id("loops") },
  returns: v.object({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    summary: v.string(),
    type: v.string(),
    nextStep: v.string(),
    tier: v.string(),
    sourceUrls: v.array(v.string()),
    ownerEmail: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactSource: v.optional(v.string()),
    lastSignalAt: v.optional(v.number()),
    lastWorkedAt: v.optional(v.number()),
    agentPausedAt: v.optional(v.number()),
    agentPauseReason: v.optional(v.string()),
    openStepKey: v.optional(v.string()),
    answeredStepKeys: v.array(v.string()),
    recentOutbound: v.array(
      v.object({ to: v.array(v.string()), subject: v.string(), body: v.string() }),
    ),
    diffs: v.array(
      v.object({
        _id: v.id("diffs"),
        watchId: v.id("watches"),
        url: v.string(),
        label: v.string(),
        kind: v.string(),
        summary: v.string(),
        before: v.optional(v.string()),
        after: v.optional(v.string()),
        detectedAt: v.number(),
      }),
    ),
    thread: v.array(
      v.object({
        direction: v.string(),
        from: v.string(),
        subject: v.string(),
        body: v.string(),
        sentAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");

    const owner = await ctx.db.get(
      (await ctx.db.get(loop.workspaceId))!.ownerId,
    );

    const rawDiffs = await ctx.db
      .query("diffs")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(10);

    const diffs = [];
    for (const diff of rawDiffs) {
      const watch = await ctx.db.get(diff.watchId);
      diffs.push({
        _id: diff._id,
        watchId: diff.watchId,
        url: watch?.url ?? "",
        label: watch?.label ?? "a watched page",
        kind: diff.kind,
        summary: diff.summary,
        before: diff.before,
        after: diff.after,
        detectedAt: diff.detectedAt,
      });
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(12);

    return {
      workspaceId: loop.workspaceId,
      title: loop.title,
      summary: loop.summary,
      type: loop.type,
      nextStep: loop.nextStep,
      tier: loop.tier,
      sourceUrls: loop.sourceUrls,
      ownerEmail: owner?.email,
      contactEmail: loop.contactEmail,
      contactSource: loop.contactSource,
      lastSignalAt: loop.lastSignalAt,
      lastWorkedAt: loop.lastWorkedAt,
      agentPausedAt: loop.agentPausedAt,
      agentPauseReason: loop.agentPauseReason,
      openStepKey: loop.openStepKey,
      answeredStepKeys: loop.answeredStepKeys ?? [],
      recentOutbound: messages
        .filter((m) => m.direction === "outbound")
        .slice(0, 6)
        .map((m) => ({ to: m.to, subject: m.subject, body: m.body })),
      diffs,
      thread: messages
        .reverse()
        .map((m) => ({
          direction: m.direction,
          from: m.from,
          subject: m.subject,
          body: m.body.slice(0, 1200),
          sentAt: m.sentAt,
        })),
    };
  },
});

export const startRun = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.optional(v.id("agents")),
    trigger: v.union(
      v.literal("schedule"),
      v.literal("manual"),
      v.literal("diff"),
      v.literal("inbound_email"),
    ),
  },
  returns: v.id("agentRuns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      trigger: args.trigger,
      status: "running",
      steps: [{ at: Date.now(), label: "The agent started work on this loop." }],
      startedAt: Date.now(),
    });
  },
});

export const addStep = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    label: v.string(),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run === null) return null;
    await ctx.db.patch(args.runId, {
      steps: [
        ...run.steps,
        { at: Date.now(), label: args.label, detail: args.detail },
      ],
    });
    return null;
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(
      v.literal("done"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    outcome: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      outcome: args.outcome,
      error: args.error,
      finishedAt: Date.now(),
    });
    return null;
  },
});

// --- the decision ---------------------------------------------------------

const DECIDE_SYSTEM = `You are the agent on one goal a person is part way through. You decide the single next action.

You act by email only. You have your own address. You never claim to be the person.

Choose one action:
- "email": send or draft one email that moves the goal forward.
- "wait": nothing changed enough to be worth an email.
- "report": tell the person something they need to decide themselves.

Classify the action honestly:
- commitsMoney is true when the email agrees to buy, book, pay, or hold funds.
- reversible is false when the email makes a promise the person cannot take back.
- riskLevel is high when the email commits money or cannot be undone, medium when it names a specific offer or a deadline, low when it only asks a question.

Email rules:
- Write as the person's assistant, not as the person. Say you act for them.
- Be short. Under 120 words. Ask one clear question.
- Name the exact thing: the listing, the price you saw, the date you saw it.
- Never invent a fact. Use only the evidence given.
- Plain English. No hype. No emoji.

recipient must be an address the evidence supports, or null when you have none.`;

const DECIDE_SCHEMA = {
  name: "agent_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "action",
      "reason",
      "recipient",
      "subject",
      "body",
      "commitsMoney",
      "reversible",
      "riskLevel",
      "nextStep",
      "stepKey",
    ],
    properties: {
      action: { type: "string", enum: ["email", "wait", "report"] },
      reason: { type: "string" },
      recipient: { type: ["string", "null"] },
      subject: { type: "string" },
      body: { type: "string" },
      commitsMoney: { type: "boolean" },
      reversible: { type: "boolean" },
      riskLevel: { type: "string", enum: ["low", "medium", "high"] },
      nextStep: { type: "string" },
      stepKey: {
        type: "string",
        description:
          "A short stable slug for what this email asks, such as ask-availability or ask-bank-details. The same question must always produce the same slug.",
      },
    },
  },
};

type Decision = {
  action: "email" | "wait" | "report";
  reason: string;
  recipient: string | null;
  subject: string;
  body: string;
  commitsMoney: boolean;
  reversible: boolean;
  riskLevel: "low" | "medium" | "high";
  nextStep: string;
  stepKey: string;
};

export const recordMessage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.id("agents"),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    threadId: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    from: v.string(),
    to: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
    approvalId: v.optional(v.id("approvals")),
    grantId: v.optional(v.id("grants")),
    evidence: v.optional(v.array(evidenceValidator)),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      direction: args.direction,
      threadId: args.threadId,
      providerMessageId: args.providerMessageId,
      from: args.from,
      to: args.to,
      subject: args.subject,
      body: args.body,
      sentAt: now,
      approvalId: args.approvalId,
    });

    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      grantId: args.grantId,
      approvalId: args.approvalId,
      actorType: args.direction === "outbound" ? "agent" : "system",
      action: args.direction === "outbound" ? "email.send" : "email.receive",
      detail:
        args.direction === "outbound"
          ? `The agent emailed ${args.to.join(", ")}: ${args.subject}`
          : `${args.from} replied: ${args.subject}`,
      inputs: { to: args.to, subject: args.subject },
      evidence: args.evidence,
      result: args.body.slice(0, 500),
      at: now,
    });

    // An answer is movement. The loop rises, and the question the agent had
    // out is now settled: it is never asked again.
    if (args.direction === "inbound") {
      const loop = await ctx.db.get(args.loopId);
      if (loop !== null && loop.status !== "closed") {
        const answered = new Set(loop.answeredStepKeys ?? []);
        if (loop.openStepKey !== undefined) answered.add(loop.openStepKey);

        await ctx.db.patch(args.loopId, {
          lastActivityAt: now,
          lastSignalAt: now,
          aliveness: Math.min(100, loop.aliveness + 20),
          status: "active",
          nextStep: `Read the reply from ${args.from} and decide.`,
          openStepKey: undefined,
          openStepAt: undefined,
          answeredStepKeys: [...answered].slice(-40),
        });
      }
    }
    return messageId;
  },
});

export const queueApproval = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.id("agents"),
    agentRunId: v.optional(v.id("agentRuns")),
    actionType: v.string(),
    actionPayload: v.any(),
    reason: v.string(),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reversible: v.boolean(),
    commitsMoney: v.boolean(),
    evidence: v.array(evidenceValidator),
    stepUpRequired: v.boolean(),
  },
  returns: v.id("approvals"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const approvalId = await ctx.db.insert("approvals", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      agentRunId: args.agentRunId,
      actionType: args.actionType,
      actionPayload: args.actionPayload,
      reason: args.reason,
      riskLevel: args.riskLevel,
      reversible: args.reversible,
      commitsMoney: args.commitsMoney,
      evidence: args.evidence,
      status: "pending",
      stepUpRequired: args.stepUpRequired,
      createdAt: now,
    });

    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      approvalId,
      actorType: "agent",
      action: "approval.request",
      detail: `The agent asked for approval: ${args.reason}`,
      inputs: args.actionPayload,
      evidence: args.evidence,
      at: now,
    });

    // Only an approval reaches the owner. An action the agent may take by
    // itself never does, because nothing is waiting on them.
    await ctx.scheduler.runAfter(0, internal.notifications.announceApproval, {
      approvalId,
    });
    return approvalId;
  },
});

export const noteInAudit = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.id("loops"),
    agentId: v.optional(v.id("agents")),
    action: v.string(),
    detail: v.string(),
    evidence: v.optional(v.array(evidenceValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      agentId: args.agentId,
      actorType: "agent",
      action: args.action,
      detail: args.detail,
      evidence: args.evidence,
      at: Date.now(),
    });
    return null;
  },
});

export const setNextStep = internalMutation({
  args: { loopId: v.id("loops"), nextStep: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.loopId, { nextStep: args.nextStep.slice(0, 300) });
    return null;
  },
});

/** Records why the agent cannot move, or clears it when it can. */
export const setBlocker = internalMutation({
  args: { loopId: v.id("loops"), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) return null;
    if (loop.blockedReason === args.reason) return null;

    await ctx.db.patch(args.loopId, { blockedReason: args.reason });
    if (args.reason !== undefined) {
      await ctx.db.insert("auditLog", {
        workspaceId: loop.workspaceId,
        loopId: args.loopId,
        actorType: "agent",
        action: "loop.blocked",
        detail: args.reason,
        at: Date.now(),
      });
    }
    return null;
  },
});

/** Records the question the agent has out and is now waiting on. */
export const openStep = internalMutation({
  args: { loopId: v.id("loops"), stepKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.stepKey === "") return null;
    await ctx.db.patch(args.loopId, {
      openStepKey: args.stepKey,
      openStepAt: Date.now(),
    });
    return null;
  },
});

/** Marks that the agent looked at this loop, so the sweep paces itself. */
export const markWorked = internalMutation({
  args: { loopId: v.id("loops") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.loopId, { lastWorkedAt: Date.now() });
    return null;
  },
});

/**
 * Runs the agent on one loop: read the evidence, decide, then either act
 * inside the grant or put the action in the approval queue.
 */
export const workLoop = internalAction({
  args: {
    loopId: v.id("loops"),
    trigger: v.union(
      v.literal("schedule"),
      v.literal("manual"),
      v.literal("diff"),
      v.literal("inbound_email"),
    ),
    recipientHint: v.optional(v.string()),
    instruction: v.optional(v.string()),
  },
  returns: v.object({
    outcome: v.string(),
    detail: v.string(),
    approvalId: v.optional(v.id("approvals")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    outcome: string;
    detail: string;
    approvalId?: Id<"approvals">;
  }> => {
    const brief = await ctx.runQuery(internal.agent.loopBrief, {
      loopId: args.loopId,
    });

    // A loop a backstop stopped stays stopped until a person clears it.
    if (brief.agentPausedAt !== undefined) {
      return {
        outcome: "paused",
        detail:
          brief.agentPauseReason ?? "This loop is stopped and waits for review.",
      };
    }

    // Nothing new has arrived since the agent last looked. Doing the work again
    // would only re-derive the same answer and send it a second time.
    const manual = args.trigger === "manual";
    const hasNewSignal =
      brief.lastSignalAt !== undefined &&
      (brief.lastWorkedAt === undefined || brief.lastSignalAt > brief.lastWorkedAt);
    if (!manual && brief.lastWorkedAt !== undefined && !hasNewSignal) {
      return {
        outcome: "idle",
        detail: "Nothing new on this loop since the agent last looked.",
      };
    }

    const agent = await ctx.runAction(internal.agents.ensureForLoop, {
      workspaceId: brief.workspaceId,
      loopId: args.loopId,
      loopTitle: brief.title,
    });

    // The owner's standing authority becomes this loop's grant. Nobody fills
    // in a form per loop.
    await ctx.runMutation(internal.grants.ensureAuto, {
      loopId: args.loopId,
      agentId: agent.agentId,
    });

    const runId: Id<"agentRuns"> = await ctx.runMutation(
      internal.agent.startRun,
      {
        workspaceId: brief.workspaceId,
        loopId: args.loopId,
        agentId: agent.agentId,
        trigger: args.trigger,
      },
    );

    try {
      const grant = await ctx.runQuery(internal.grants.activeForLoop, {
        loopId: args.loopId,
      });

      await ctx.runMutation(internal.agent.addStep, {
        runId,
        label:
          grant === null
            ? "The agent found no live grant on this loop."
            : `The agent read its grant: ${grant.tier} tier, ${grant.allowedActions.length} allowed actions.`,
      });

      const apiKey = await resolveOpenAiKey(ctx, brief.workspaceId);
      const prompt = buildPrompt(brief, args.recipientHint, args.instruction);

      const { value: decision } = await askForJson<Decision>(apiKey, {
        system: DECIDE_SYSTEM,
        user: prompt,
        schema: DECIDE_SCHEMA,
        reasoningEffort: "medium",
      });

      await ctx.runMutation(internal.agent.addStep, {
        runId,
        label: `The agent chose to ${decision.action}.`,
        detail: decision.reason,
      });
      await ctx.runMutation(internal.agent.setNextStep, {
        loopId: args.loopId,
        nextStep: decision.nextStep,
      });

      const evidence = brief.diffs.slice(0, 3).map((d) => ({
        watchId: d.watchId,
        diffId: d._id,
        url: d.url,
        label: d.label,
        before: d.before,
        after: d.after,
        observedAt: d.detectedAt,
      }));

      if (decision.action !== "email") {
        await ctx.runMutation(internal.agent.noteInAudit, {
          workspaceId: brief.workspaceId,
          loopId: args.loopId,
          agentId: agent.agentId,
          action: `agent.${decision.action}`,
          detail: decision.reason,
          evidence,
        });
        await ctx.runMutation(internal.agent.finishRun, {
          runId,
          status: "done",
          outcome: decision.reason,
        });
        return { outcome: decision.action, detail: decision.reason };
      }

      // Where to write comes from the page Firecrawl already read. The manual
      // hint is an escape hatch, never the normal path.
      const recipient =
        brief.contactEmail ??
        args.recipientHint ??
        (decision.recipient !== null && decision.recipient.includes("@")
          ? decision.recipient
          : null);

      if (recipient === null || !recipient.includes("@")) {
        const detail =
          "No contact found on the watched pages. Loomstate keeps watching for one.";
        await ctx.runMutation(internal.agent.setBlocker, {
          loopId: args.loopId,
          reason: detail,
        });
        await ctx.runMutation(internal.agent.finishRun, {
          runId,
          status: "blocked",
          outcome: detail,
        });
        return { outcome: "blocked", detail };
      }

      await ctx.runMutation(internal.agent.setBlocker, {
        loopId: args.loopId,
        reason: undefined,
      });

      // The other side already answered this exact question. Asking again in
      // fresh words is the failure this guard exists to stop.
      const stepKey = stepKeyOf(decision.stepKey ?? decision.subject);
      if (stepKey !== "" && brief.answeredStepKeys.includes(stepKey)) {
        const detail = `The seller already answered "${stepKey}". The agent sent nothing.`;
        await ctx.runMutation(internal.agent.addStep, {
          runId,
          label: "The agent stopped a repeat question.",
          detail,
        });
        await ctx.runMutation(internal.agent.finishRun, {
          runId,
          status: "done",
          outcome: detail,
        });
        return { outcome: "settled", detail };
      }

      // Even with a new step name, near-identical wording to something already
      // sent to this address is a resend.
      const draft = `${decision.subject} ${decision.body}`;
      const echo = brief.recentOutbound.find(
        (m) =>
          m.to.some((address) => address.includes(recipient)) &&
          isResend(`${m.subject} ${m.body}`, draft),
      );
      if (echo !== undefined) {
        const detail =
          "The agent already sent this message to this address. It sent nothing.";
        await ctx.runMutation(internal.agent.addStep, {
          runId,
          label: "The agent stopped a near-duplicate email.",
          detail,
        });
        await ctx.runMutation(internal.agent.finishRun, {
          runId,
          status: "done",
          outcome: detail,
        });
        return { outcome: "duplicate", detail };
      }

      // The risk gate. Money and one-way actions never bypass the queue, at
      // any tier. This check is code, not a prompt the model can talk past.
      const mustAsk =
        decision.commitsMoney ||
        !decision.reversible ||
        decision.riskLevel === "high";
      const canSendItself =
        grant !== null &&
        grant.tier === "act" &&
        grant.allowedActions.includes("email.ask") &&
        !mustAsk;

      if (!canSendItself) {
        const approvalId: Id<"approvals"> = await ctx.runMutation(
          internal.agent.queueApproval,
          {
            workspaceId: brief.workspaceId,
            loopId: args.loopId,
            agentId: agent.agentId,
            agentRunId: runId,
            actionType: "email.send",
            actionPayload: {
              to: [recipient],
              subject: decision.subject,
              body: decision.body,
              from: agent.inboxAddress,
            },
            reason: decision.reason,
            riskLevel: decision.riskLevel,
            reversible: decision.reversible,
            commitsMoney: decision.commitsMoney,
            evidence,
            stepUpRequired: mustAsk,
          },
        );

        const detail = mustAsk
          ? "This action commits money or cannot be undone. It needs your approval and a step-up confirmation."
          : grant === null
            ? "The agent has no grant on this loop, so the email waits for your approval."
            : "The agent drafted the email. You send it.";

        await ctx.runMutation(internal.agent.addStep, {
          runId,
          label: "The agent put the email in the approval queue.",
          detail,
        });
        await ctx.runMutation(internal.agent.finishRun, {
          runId,
          status: "blocked",
          outcome: detail,
        });
        return { outcome: "queued", detail, approvalId };
      }

      // The last gate before anything leaves. Counts real sends and stops the
      // agent outright when a loop or the workspace goes over its limit.
      const budget = await ctx.runMutation(internal.budget.checkAndReserve, {
        loopId: args.loopId,
      });
      if (!budget.allowed) {
        const detail = budget.reason ?? "The agent is over its send limit.";
        await ctx.runMutation(internal.agent.addStep, {
          runId,
          label: "The send limit stopped this email.",
          detail,
        });
        await ctx.runMutation(internal.agent.finishRun, {
          runId,
          status: "blocked",
          outcome: detail,
        });
        return { outcome: "capped", detail };
      }

      const sent = await sendMessage(requireAgentMailKey(), agent.inboxId, {
        to: [recipient],
        subject: decision.subject,
        text: decision.body,
      });

      await ctx.runMutation(internal.agent.recordMessage, {
        workspaceId: brief.workspaceId,
        loopId: args.loopId,
        agentId: agent.agentId,
        direction: "outbound",
        threadId: sent.thread_id,
        providerMessageId: sent.message_id,
        from: agent.inboxAddress,
        to: [recipient],
        subject: decision.subject,
        body: decision.body,
        grantId: grant._id,
        evidence,
      });

      await ctx.runMutation(internal.agent.openStep, {
        loopId: args.loopId,
        stepKey,
      });

      const detail = `The agent emailed ${recipient} from ${agent.inboxAddress}.`;
      await ctx.runMutation(internal.agent.finishRun, {
        runId,
        status: "done",
        outcome: detail,
      });
      return { outcome: "sent", detail };
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The run failed.";
      await ctx.runMutation(internal.agent.finishRun, {
        runId,
        status: "failed",
        error: message,
      });
      throw caught;
    }
  },
});

/** Runs the agent on one loop on the owner's request. */
export const workLoopNow = action({
  args: {
    loopId: v.id("loops"),
    recipient: v.optional(v.string()),
    instruction: v.optional(v.string()),
  },
  returns: v.object({
    outcome: v.string(),
    detail: v.string(),
    approvalId: v.optional(v.id("approvals")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    outcome: string;
    detail: string;
    approvalId?: Id<"approvals">;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    await ctx.runQuery(internal.agent.assertLoopAccess, { loopId: args.loopId });
    return await ctx.runAction(internal.agent.workLoop, {
      loopId: args.loopId,
      trigger: "manual",
      recipientHint: args.recipient,
      instruction: args.instruction,
    });
  },
});

export const assertLoopAccess = internalQuery({
  args: { loopId: v.id("loops") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    await requireDocIn(ctx, loop, "Loop");
    return null;
  },
});

function requireAgentMailKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (key === undefined || key === "") {
    throw new Error("AGENTMAIL_API_KEY is not set on this deployment.");
  }
  return key;
}

function buildPrompt(
  brief: {
    title: string;
    summary: string;
    type: string;
    nextStep: string;
    tier: string;
    sourceUrls: string[];
    diffs: {
      kind: string;
      summary: string;
      before?: string;
      after?: string;
      url: string;
      detectedAt: number;
    }[];
    thread: {
      direction: string;
      from: string;
      subject: string;
      body: string;
    }[];
    contactEmail?: string;
    contactSource?: string;
  },
  recipientHint: string | undefined,
  instruction: string | undefined,
): string {
  const contact = brief.contactEmail ?? recipientHint;
  const contactSource = brief.contactSource;
  return [
    `Goal: ${brief.title}`,
    `What it is about: ${brief.summary}`,
    `Kind: ${brief.type}`,
    `The step the person expects next: ${brief.nextStep}`,
    "",
    "Evidence from the live web:",
    brief.diffs.length === 0
      ? "(no change detected yet)"
      : brief.diffs
          .map(
            (d) =>
              `- [${d.kind}] ${d.summary} (${d.before ?? "none"} -> ${d.after ?? "none"}) seen ${new Date(d.detectedAt).toISOString()} at ${d.url}`,
          )
          .join("\n"),
    "",
    "Pages in this loop:",
    brief.sourceUrls.slice(0, 8).map((u) => `- ${u}`).join("\n"),
    "",
    "Email so far:",
    brief.thread.length === 0
      ? "(no email yet)"
      : brief.thread
          .map((m) => `- ${m.direction} from ${m.from}: ${m.subject}\n  ${m.body}`)
          .join("\n"),
    "",
    contact === undefined
      ? "No contact address was found on the watched pages. Return null for recipient."
      : `Write to this address, read off ${contactSource ?? "the watched page"}: ${contact}`,
    instruction === undefined || instruction.trim() === ""
      ? ""
      : `\nWhat the person asked you to do: ${instruction.trim()}\nFollow this, and classify the risk of what it asks honestly.`,
  ].join("\n");
}
