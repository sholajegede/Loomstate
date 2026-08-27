/**
 * A small OpenAI client. Loomstate asks the model for structured JSON only, so
 * every call goes through one helper with a schema and a strict decode.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** The model chain. Loomstate falls back when a deployment cannot use the first. */
const MODELS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"];

function modelChain(): string[] {
  const preferred = process.env.OPENAI_MODEL;
  if (preferred === undefined || preferred === "") return MODELS;
  return [preferred, ...MODELS.filter((m) => m !== preferred)];
}

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

/**
 * Sends one prompt and decodes the JSON reply against a schema.
 * Throws with the provider's own message when the call fails.
 */
export async function askForJson<T>(
  apiKey: string,
  args: {
    system: string;
    user: string;
    schema: JsonSchema;
    reasoningEffort?: "low" | "medium" | "high";
  },
): Promise<{ value: T; model: string }> {
  let lastError = "OpenAI did not answer.";

  for (const model of modelChain()) {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { ...args.schema, strict: true },
      },
    };
    if (model.startsWith("gpt-5") && args.reasoningEffort !== undefined) {
      body.reasoning_effort = args.reasoningEffort;
    }

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      const text = payload.choices[0]?.message?.content ?? "";
      try {
        return { value: JSON.parse(text) as T, model };
      } catch {
        lastError = "OpenAI returned a reply Loomstate could not read.";
        continue;
      }
    }

    const detail = await response.text();
    // An unknown model or an account without access is worth retrying with the
    // next model. Anything else is the caller's problem and stops the chain.
    const retryable =
      response.status === 404 ||
      detail.includes("model_not_found") ||
      detail.includes("does not exist");
    lastError = `OpenAI returned ${response.status}. ${detail.slice(0, 300)}`;
    if (!retryable) break;
  }

  throw new Error(lastError);
}

/**
 * Sends a short conversation and returns the reply as plain text. The chat
 * surface uses this: it answers a person in prose, not in a schema.
 */
export async function askForText(
  apiKey: string,
  args: {
    system: string;
    turns: { role: "user" | "assistant"; content: string }[];
    maxTokens?: number;
  },
): Promise<{ text: string; model: string }> {
  let lastError = "OpenAI did not answer.";

  for (const model of modelChain()) {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "system", content: args.system }, ...args.turns],
      max_completion_tokens: args.maxTokens ?? 900,
    };

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      const text = (payload.choices[0]?.message?.content ?? "").trim();
      if (text === "") {
        lastError = "OpenAI returned an empty reply.";
        continue;
      }
      return { text, model };
    }

    const detail = await response.text();
    const retryable =
      response.status === 404 ||
      detail.includes("model_not_found") ||
      detail.includes("does not exist") ||
      detail.includes("max_completion_tokens");
    lastError = `OpenAI returned ${response.status}. ${detail.slice(0, 300)}`;
    if (!retryable) break;
  }

  throw new Error(lastError);
}
