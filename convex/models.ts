import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireSession, requireWorkspaceWrite } from "./lib/access";
import { resolveOpenAiKey } from "./secrets";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EFFORT,
  isChatModel,
  rankModel,
  supportsReasoningEffort,
} from "./lib/models";

/**
 * Which model the chat answers with. The list comes from the owner's own key,
 * so it shows what that key can actually reach rather than a list Loomstate
 * imagines.
 */

const effort = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

/** The model and effort this workspace uses, with the defaults filled in. */
export const chatPreference = query({
  args: {},
  returns: v.object({
    model: v.string(),
    effort,
    supportsEffort: v.boolean(),
  }),
  handler: async (ctx) => {
    const { workspace } = await requireSession(ctx);
    const model = workspace.chatModel ?? DEFAULT_CHAT_MODEL;
    return {
      model,
      effort: workspace.chatEffort ?? DEFAULT_EFFORT,
      supportsEffort: supportsReasoningEffort(model),
    };
  },
});

/** Saves the choice. It applies to the chat only. */
export const setChatPreference = mutation({
  args: { model: v.optional(v.string()), effort: v.optional(effort) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireSession(ctx);
    await requireWorkspaceWrite(ctx, workspace._id);

    const patch: { chatModel?: string; chatEffort?: "low" | "medium" | "high" } = {};
    if (args.model !== undefined) {
      const model = args.model.trim();
      if (model === "") throw new Error("Choose a model.");
      patch.chatModel = model;
    }
    if (args.effort !== undefined) patch.chatEffort = args.effort;
    if (Object.keys(patch).length === 0) return null;

    await ctx.db.patch(workspace._id, patch);
    return null;
  },
});

/**
 * Asks OpenAI which models this key can reach, then keeps the ones that can
 * answer a chat turn. Loomstate marks which of those take a reasoning effort.
 */
export const available = action({
  args: {},
  returns: v.object({
    models: v.array(
      v.object({ id: v.string(), supportsEffort: v.boolean() }),
    ),
    detail: v.string(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    models: { id: string; supportsEffort: boolean }[];
    detail: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const workspaceId: Id<"workspaces"> = await ctx.runQuery(
      internal.chat.workspaceForCaller,
      {},
    );
    const apiKey = await resolveOpenAiKey(ctx, workspaceId);

    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `OpenAI would not list your models. It returned ${response.status}.`,
      );
    }

    const payload = (await response.json()) as { data?: { id: string }[] };
    const models = (payload.data ?? [])
      .map((m) => m.id)
      .filter(isChatModel)
      .sort((a, b) => rankModel(b) - rankModel(a) || a.localeCompare(b))
      .map((id) => ({ id, supportsEffort: supportsReasoningEffort(id) }));

    return {
      models,
      detail:
        models.length === 0
          ? "Your key reaches no chat model."
          : `Your key reaches ${models.length} chat models.`,
    };
  },
});
