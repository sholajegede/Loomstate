/**
 * What a model can do.
 *
 * OpenAI's model list says which models a key can reach, but not what each one
 * supports. Reasoning effort is a property of the model family, so the rule
 * below is by family and is deliberately narrow: a model Loomstate does not
 * recognise is treated as having no effort setting rather than being guessed at.
 * A wrong guess here would send a parameter the model rejects, and the chat
 * would fail for the person instead of simply offering one fewer control.
 */

/** Families that accept reasoning_effort. */
const REASONING_FAMILIES = [/^gpt-5/, /^o1(-|$)/, /^o3(-|$)/, /^o4(-|$)/];

/** Model ids that are not for chat, however they are named. */
const NOT_CHAT = [
  /embedding/,
  /whisper/,
  /tts/,
  /^dall-e/,
  /moderation/,
  /audio/,
  /transcribe/,
  /realtime/,
  /image/,
  /search/,
  /computer-use/,
  /-instruct$/,
  /^davinci/,
  /^babbage/,
  /codex/,
];

/** True when this model takes a reasoning_effort setting. */
export function supportsReasoningEffort(model: string): boolean {
  const id = model.trim().toLowerCase();
  // Every "-chat" variant in the gpt-5 family is the non-reasoning one, at any
  // point version: gpt-5-chat-latest, gpt-5.1-chat-latest, and so on.
  if (/^gpt-5[\d.]*-chat/.test(id)) return false;
  return REASONING_FAMILIES.some((pattern) => pattern.test(id));
}

/** True when this model can answer a chat turn. */
export function isChatModel(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (NOT_CHAT.some((pattern) => pattern.test(id))) return false;
  return id.startsWith("gpt-") || /^o[134](-|$)/.test(id);
}

/**
 * Newest and most capable first, so the list a person reads starts with what
 * they most likely want. Within a family, a plain id sorts above a dated one.
 */
export function rankModel(model: string): number {
  const id = model.toLowerCase();
  let score = 0;
  if (id.startsWith("gpt-5")) score = 500;
  else if (id.startsWith("o3")) score = 420;
  else if (id.startsWith("o4")) score = 410;
  else if (id.startsWith("gpt-4.1")) score = 400;
  else if (id.startsWith("gpt-4o")) score = 300;
  else if (id.startsWith("o1")) score = 250;
  else if (id.startsWith("gpt-4")) score = 200;
  else score = 100;

  // A smaller variant is cheaper but weaker, so it sits below its parent.
  if (id.includes("-mini")) score -= 20;
  if (id.includes("-nano")) score -= 30;
  // A dated snapshot sits below the moving alias of the same family.
  if (/\d{4}-\d{2}-\d{2}/.test(id)) score -= 5;
  return score;
}

/** The model Loomstate uses when the owner has not chosen one. */
export const DEFAULT_CHAT_MODEL = "gpt-5-mini";

/** The effort Loomstate uses when the model takes one and none is chosen. */
export const DEFAULT_EFFORT = "low";
