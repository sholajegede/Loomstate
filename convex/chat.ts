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
import { requireDocIn, requireSession, requireWorkspaceWrite } from "./lib/access";
import { askForText } from "./lib/openai";
import { resolveOpenAiKey } from "./secrets";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EFFORT,
  supportsReasoningEffort,
} from "./lib/models";
import { timeAgo } from "./lib/when";

/**
 * A read-only chat over what Loomstate already recorded.
 *
 * Every answer is built from records fetched here first: the pages behind a
 * loop, its watches and the changes they found, the email sent and received,
 * the approvals waiting, and the audit log. The model is given that text and
 * told to answer from it alone. It cannot act, send, or change anything.
 */

const MAX_TURNS_IN_PROMPT = 8;

/** "1 agent run", "3 agent runs". The provenance line is read by a person. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// --- retrieval ------------------------------------------------------------

/** Everything worth knowing about one loop, as text the model can read. */
export const loopContext = internalQuery({
  args: { loopId: v.id("loops") },
  returns: v.object({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    text: v.string(),
    sources: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");

    const sources: string[] = [];
    const lines: string[] = [];

    lines.push(`LOOP: ${loop.title}`);
    lines.push(`What it is about: ${loop.summary}`);
    lines.push(
      `Kind: ${loop.type}. Status: ${loop.status}. Aliveness: ${loop.aliveness} out of 100.`,
    );
    lines.push(`Next step on record: ${loop.nextStep}`);
    lines.push(`Authority the agent holds on this loop: ${loop.tier}`);
    lines.push(`Last activity: ${timeAgo(loop.lastActivityAt)}`);
    if (loop.lastWorkedAt !== undefined) {
      lines.push(`The agent last worked this loop ${timeAgo(loop.lastWorkedAt)}.`);
    } else {
      lines.push("The agent has not worked this loop yet.");
    }
    if (loop.contactEmail !== undefined) {
      lines.push(
        `Where the agent would write on this loop: ${loop.contactEmail}, read off ${loop.contactSource ?? "a watched page"}. This is a destination, not a record that anything was sent.`,
      );
    } else {
      lines.push("No contact address has been found for this loop.");
    }
    if (loop.blockedReason !== undefined) {
      lines.push(`BLOCKED: ${loop.blockedReason}`);
    }
    if (loop.agentPausedAt !== undefined) {
      lines.push(
        `STOPPED FOR REVIEW: ${loop.agentPauseReason ?? "a limit was reached"}. The agent sends nothing until a person clears this.`,
      );
    }
    sources.push("the loop record");

    // The live grant, which is what actually decides whether it may send.
    const grants = await ctx.db
      .query("grants")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(20);
    const live = grants.find(
      (g) => g.revokedAt === undefined && g.expiresAt > Date.now(),
    );
    lines.push("");
    lines.push(
      live === undefined
        ? "GRANT: none is live, so every action the agent proposes goes to the approval queue."
        : `GRANT: ${live.tier} tier, allowed actions ${live.allowedActions.join(", ") || "none outbound"}, expires ${new Date(live.expiresAt).toISOString()}.`,
    );
    if (grants.length > 0) sources.push("the authority grants");

    // The pages the loop was built from.
    const events = await ctx.db
      .query("events")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(12);
    if (events.length > 0) {
      lines.push("");
      lines.push("PAGES THE PERSON READ:");
      for (const event of events) {
        lines.push(
          `- ${timeAgo(event.occurredAt)}, ${Math.round(event.dwellMs / 1000)}s on ${event.host}: ${event.title} (${event.url})`,
        );
      }
      sources.push(count(events.length, "browsing event", "browsing events"));
    }

    // The watches and what they found.
    const watches = await ctx.db
      .query("watches")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .take(10);
    if (watches.length > 0) {
      lines.push("");
      lines.push("PAGES LOOMSTATE WATCHES:");
      for (const watch of watches) {
        const snapshot =
          watch.lastSnapshotId === undefined
            ? null
            : await ctx.db.get(watch.lastSnapshotId);
        lines.push(
          `- ${watch.label} (${watch.url}), checked every ${watch.intervalMinutes} minutes, ${watch.active ? "active" : "stopped"}${
            watch.lastCrawlAt ? `, last read ${timeAgo(watch.lastCrawlAt)}` : ", never read"
          }${snapshot?.price ? `, price now ${snapshot.price}` : ""}${
            snapshot?.availability && snapshot.availability !== "unknown"
              ? `, ${snapshot.availability}`
              : ""
          }${watch.lastError ? `, last error: ${watch.lastError}` : ""}`,
        );
      }
      sources.push(count(watches.length, "watched page", "watched pages"));
    }

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(15);
    if (diffs.length > 0) {
      lines.push("");
      lines.push("CHANGES LOOMSTATE FOUND ON THOSE PAGES:");
      for (const diff of diffs) {
        lines.push(
          `- ${timeAgo(diff.detectedAt)} [${diff.kind}] ${diff.summary} (${diff.before ?? "none"} -> ${diff.after ?? "none"})`,
        );
      }
      sources.push(count(diffs.length, "detected change", "detected changes"));
    }

    // The email, which is usually what a person is asking about.
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(12);
    if (messages.length > 0) {
      lines.push("");
      lines.push("EMAIL ON THIS LOOP, NEWEST FIRST:");
      for (const message of messages) {
        lines.push(
          `- ${timeAgo(message.sentAt)} ${message.direction} ${
            message.direction === "outbound"
              ? `to ${message.to.join(", ")}`
              : `from ${message.from}`
          } | subject: ${message.subject}`,
        );
        lines.push(`  body: ${message.body.slice(0, 700)}`);
      }
      sources.push(count(messages.length, "email", "emails"));
    } else {
      lines.push("");
      lines.push(
        "EMAIL ON THIS LOOP: none. The agent has sent no email and received no reply on this loop.",
      );
    }

    // Why an email went out, and under what authority.
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(8);
    if (runs.length > 0) {
      lines.push("");
      lines.push("AGENT RUNS ON THIS LOOP:");
      for (const run of runs) {
        lines.push(
          `- ${timeAgo(run.startedAt)} started by ${run.trigger}, ended ${run.status}${run.outcome ? `: ${run.outcome}` : ""}${run.error ? ` (error: ${run.error})` : ""}`,
        );
      }
      sources.push(count(runs.length, "agent run", "agent runs"));
    } else {
      lines.push("");
      lines.push("AGENT RUNS ON THIS LOOP: none. The agent has never run on this loop.");
    }

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(8);
    if (approvals.length > 0) {
      lines.push("");
      lines.push("APPROVALS ON THIS LOOP:");
      for (const approval of approvals) {
        const payload = (approval.editedPayload ?? approval.actionPayload) as {
          subject?: string;
          to?: string[];
        };
        lines.push(
          `- ${timeAgo(approval.createdAt)} ${approval.status}, ${approval.riskLevel} risk${
            approval.commitsMoney ? ", commits money" : ""
          }${approval.reversible ? "" : ", cannot be undone"}${
            approval.stepUpRequired ? ", needs a fresh passkey check" : ""
          } | reason: ${approval.reason} | would email ${(payload.to ?? []).join(", ")} with subject "${payload.subject ?? ""}"`,
        );
      }
      sources.push(count(approvals.length, "approval", "approvals"));
    } else {
      lines.push("");
      lines.push(
        "APPROVALS ON THIS LOOP: none. Nothing on this loop is waiting in the approval queue.",
      );
    }

    const audit = await ctx.db
      .query("auditLog")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(25);
    if (audit.length > 0) {
      lines.push("");
      lines.push("AUDIT LOG FOR THIS LOOP:");
      for (const entry of audit) {
        lines.push(
          `- ${timeAgo(entry.at)} [${entry.actorType}] ${entry.action}: ${entry.detail}`,
        );
      }
      sources.push(count(audit.length, "audit entry", "audit entries"));
    }

    return {
      workspaceId: loop.workspaceId,
      title: loop.title,
      text: lines.join("\n"),
      sources,
    };
  },
});

/** The agent's recent activity across every loop, as text the model can read. */
export const workspaceContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ text: v.string(), sources: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const sources: string[] = [];
    const lines: string[] = [];

    const workspace = await ctx.db.get(args.workspaceId);
    lines.push(
      `WORKSPACE SETTINGS: standing authority is ${workspace?.defaultTier ?? "draft"}. Loomstate is ${
        workspace?.autopilot === false ? "PAUSED and does no work" : "running on a schedule"
      }.`,
    );
    sources.push("the workspace settings");

    const loops = await ctx.db
      .query("loops")
      .withIndex("by_workspace_activity", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(25);
    if (loops.length > 0) {
      lines.push("");
      lines.push("LOOPS, MOST RECENTLY ACTIVE FIRST:");
      for (const loop of loops) {
        lines.push(
          `- "${loop.title}" [id ${loop._id}] ${loop.type}, ${loop.status}, aliveness ${loop.aliveness}, ${loop.tier} tier, last activity ${timeAgo(loop.lastActivityAt)}. Next step: ${loop.nextStep}${
            loop.blockedReason ? ` BLOCKED: ${loop.blockedReason}` : ""
          }${loop.agentPausedAt !== undefined ? " STOPPED FOR REVIEW." : ""}`,
        );
      }
      sources.push(count(loops.length, "loop", "loops"));
    }

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .order("desc")
      .take(15);
    lines.push("");
    if (approvals.length === 0) {
      lines.push("NOTHING IS WAITING FOR THE PERSON TO APPROVE.");
    } else {
      lines.push("WAITING FOR THE PERSON TO APPROVE:");
      for (const approval of approvals) {
        const loop = await ctx.db.get(approval.loopId);
        const payload = (approval.editedPayload ?? approval.actionPayload) as {
          subject?: string;
          to?: string[];
        };
        lines.push(
          `- ${timeAgo(approval.createdAt)} on "${loop?.title ?? "a loop"}": ${approval.riskLevel} risk${
            approval.commitsMoney ? ", commits money" : ""
          }${approval.stepUpRequired ? ", needs a fresh passkey check" : ""} | ${approval.reason} | would email ${(payload.to ?? []).join(", ")} with subject "${payload.subject ?? ""}"`,
        );
      }
      sources.push(count(approvals.length, "pending approval", "pending approvals"));
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_workspace_time", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(15);
    if (messages.length > 0) {
      lines.push("");
      lines.push("RECENT EMAIL ACROSS EVERY LOOP:");
      for (const message of messages) {
        const loop = await ctx.db.get(message.loopId);
        lines.push(
          `- ${timeAgo(message.sentAt)} ${message.direction} on "${loop?.title ?? "a loop"}" ${
            message.direction === "outbound"
              ? `to ${message.to.join(", ")}`
              : `from ${message.from}`
          }: ${message.subject}`,
        );
      }
      sources.push(count(messages.length, "email", "emails"));
    }

    const audit = await ctx.db
      .query("auditLog")
      .withIndex("by_workspace_time", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(50);
    if (audit.length > 0) {
      lines.push("");
      lines.push("AUDIT LOG ACROSS THE WORKSPACE, NEWEST FIRST:");
      for (const entry of audit) {
        const loop =
          entry.loopId === undefined ? null : await ctx.db.get(entry.loopId);
        lines.push(
          `- ${timeAgo(entry.at)} [${entry.actorType}] ${entry.action}${loop ? ` on "${loop.title}"` : ""}: ${entry.detail}`,
        );
      }
      sources.push(count(audit.length, "audit entry", "audit entries"));
    }

    return { text: lines.join("\n"), sources };
  },
});

// --- the transcript -------------------------------------------------------

const turnShape = v.object({
  _id: v.id("chatTurns"),
  role: v.string(),
  text: v.string(),
  sources: v.optional(v.array(v.string())),
  at: v.number(),
});

/** The conversation so far, for one loop or for the workspace. */
export const history = query({
  args: { loopId: v.optional(v.id("loops")) },
  returns: v.array(turnShape),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    if (args.loopId !== undefined) {
      const loop = await ctx.db.get(args.loopId);
      await requireDocIn(ctx, loop, "Loop");
    }

    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_workspace_scope_time", (q) =>
        q.eq("workspaceId", workspace._id).eq("loopId", args.loopId),
      )
      .order("desc")
      .take(40);

    return turns.reverse().map((turn) => ({
      _id: turn._id,
      role: turn.role,
      text: turn.text,
      sources: turn.sources,
      at: turn.at,
    }));
  },
});

export const recentTurns = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.optional(v.id("loops")),
  },
  returns: v.array(v.object({ role: v.string(), text: v.string() })),
  handler: async (ctx, args) => {
    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_workspace_scope_time", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("loopId", args.loopId),
      )
      .order("desc")
      .take(MAX_TURNS_IN_PROMPT);
    return turns.reverse().map((t) => ({ role: t.role, text: t.text }));
  },
});

export const addTurn = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    loopId: v.optional(v.id("loops")),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    sources: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
  },
  returns: v.id("chatTurns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("chatTurns", {
      workspaceId: args.workspaceId,
      loopId: args.loopId,
      role: args.role,
      text: args.text.slice(0, 4000),
      sources: args.sources,
      model: args.model,
      at: Date.now(),
    });
  },
});

/** Clears one conversation. It removes chat only, never a record it read. */
export const clear = mutation({
  args: { loopId: v.optional(v.id("loops")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);

    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_workspace_scope_time", (q) =>
        q.eq("workspaceId", workspace._id).eq("loopId", args.loopId),
      )
      .take(200);
    for (const turn of turns) await ctx.db.delete(turn._id);
    return null;
  },
});

export const workspaceForCaller = internalQuery({
  args: {},
  returns: v.id("workspaces"),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    return workspace._id;
  },
});

/** The model and effort the owner chose for the chat. */
export const answerSettings = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    model: v.string(),
    effort: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    return {
      model: workspace?.chatModel ?? DEFAULT_CHAT_MODEL,
      effort: workspace?.chatEffort ?? DEFAULT_EFFORT,
    };
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

// --- answering ------------------------------------------------------------

const SYSTEM = `You answer a person's questions about their own Loomstate loops.

You are given records Loomstate has already stored: the pages the person read, the pages it watches, the changes it found, the email it sent and received, the approvals waiting, the authority grants, and the audit log. Answer from those records alone.

Rules:
- Ground every claim in a record you were given. Quote the specific price, address, subject line, date, or audit entry that supports it.
- If the records do not show the answer, say so plainly. Never guess, and never fill a gap with something that sounds likely.
- Never say the agent sent, wrote, or emailed anything unless an outbound email appears under EMAIL ON THIS LOOP. A contact address on the loop says where the agent would write, not that it wrote. A finished agent run does not mean an email left.
- When asked why the agent did something, cite the run, the grant that allowed it, and the evidence behind it.
- Be short. A few sentences, or a short list. No preamble.
- Write plain English. Simple present tense where it fits. No hype.
- You only read. If the person asks you to send, approve, or change something, tell them which screen does it: the approval queue approves an action, the loop page changes authority, settings pauses the agent.
- Refer to time the way the records do, such as "3h ago".`;

/**
 * Answers one question about a loop, or about the workspace when no loop is
 * given. Reads records first, then asks the model to answer from them.
 */
export const ask = action({
  args: {
    loopId: v.optional(v.id("loops")),
    question: v.string(),
  },
  returns: v.object({
    answer: v.string(),
    sources: v.array(v.string()),
    model: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ answer: string; sources: string[]; model?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const question = args.question.trim();
    if (question === "") throw new Error("Ask a question first.");
    if (question.length > 1000) {
      throw new Error("That question is too long. Keep it under 1000 characters.");
    }

    if (args.loopId !== undefined) {
      await ctx.runQuery(internal.chat.assertLoopAccess, { loopId: args.loopId });
    }
    const workspaceId: Id<"workspaces"> = await ctx.runQuery(
      internal.chat.workspaceForCaller,
      {},
    );

    const context =
      args.loopId !== undefined
        ? await ctx.runQuery(internal.chat.loopContext, { loopId: args.loopId })
        : await ctx.runQuery(internal.chat.workspaceContext, { workspaceId });

    const priorTurns = await ctx.runQuery(internal.chat.recentTurns, {
      workspaceId,
      loopId: args.loopId,
    });

    await ctx.runMutation(internal.chat.addTurn, {
      workspaceId,
      loopId: args.loopId,
      role: "user",
      text: question,
    });

    const apiKey = await resolveOpenAiKey(ctx, workspaceId);
    const scope =
      args.loopId !== undefined
        ? `The person is asking about one loop.`
        : `The person is asking about everything Loomstate has been doing.`;

    const turns: { role: "user" | "assistant"; content: string }[] = [
      ...priorTurns.map((t) => ({
        role: t.role === "user" ? ("user" as const) : ("assistant" as const),
        content: t.text,
      })),
      {
        role: "user" as const,
        content: [
          scope,
          "",
          "RECORDS:",
          context.text,
          "",
          `QUESTION: ${question}`,
        ].join("\n"),
      },
    ];

    const settings = await ctx.runQuery(internal.chat.answerSettings, {
      workspaceId,
    });
    const { text, model } = await askForText(apiKey, {
      system: SYSTEM,
      turns,
      model: settings.model,
      // The effort is sent only for a model whose family takes one.
      reasoningEffort: supportsReasoningEffort(settings.model)
        ? settings.effort
        : undefined,
    });

    await ctx.runMutation(internal.chat.addTurn, {
      workspaceId,
      loopId: args.loopId,
      role: "assistant",
      text,
      sources: context.sources,
      model,
    });

    return { answer: text, sources: context.sources, model };
  },
});
