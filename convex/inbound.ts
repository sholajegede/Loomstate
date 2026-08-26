import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Handles one inbound email. The reply is stored on the loop, then the agent
 * reads it and decides the next step. This is what makes a loop advance on
 * screen without anyone touching the dashboard.
 */
export const handleReply = internalAction({
  args: {
    inboxId: v.string(),
    from: v.string(),
    to: v.array(v.string()),
    subject: v.string(),
    text: v.string(),
    threadId: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
  },
  returns: v.object({ handled: v.boolean(), detail: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ handled: boolean; detail: string }> => {
    const owner = await ctx.runQuery(internal.agents.inboxOwner, {
      inboxId: args.inboxId,
    });
    if (owner === null) {
      return { handled: false, detail: "No agent owns this inbox." };
    }

    const messageId: Id<"messages"> = await ctx.runMutation(
      internal.agent.recordMessage,
      {
        workspaceId: owner.workspaceId,
        loopId: owner.loopId,
        agentId: owner.agentId,
        direction: "inbound",
        threadId: args.threadId,
        providerMessageId: args.providerMessageId,
        from: args.from,
        to: args.to,
        subject: args.subject,
        body: args.text.slice(0, 8000),
        evidence: undefined,
      },
    );

    // The agent reads the reply and decides what to do next. It answers only
    // inside its grant; anything heavier lands in the approval queue.
    await ctx.scheduler.runAfter(0, internal.agent.workLoop, {
      loopId: owner.loopId,
      trigger: "inbound_email",
      recipientHint: args.from,
    });

    return {
      handled: true,
      detail: `Loomstate stored message ${messageId} and started an agent run.`,
    };
  },
});
