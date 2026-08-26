/**
 * AgentMail gives each agent its own inbox. The agent sends and receives real
 * email from that address. Loomstate never sends from the user's own email.
 */

const BASE = "https://api.agentmail.to/v0";

async function call<T>(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `AgentMail returned ${response.status}. ${text.slice(0, 300)}`,
    );
  }
  return (text === "" ? {} : JSON.parse(text)) as T;
}

export type Inbox = { inbox_id: string; email: string };

/** Creates the inbox one agent owns. */
export async function createInbox(
  apiKey: string,
  args: { username: string; displayName: string },
): Promise<Inbox> {
  return await call<Inbox>(apiKey, "/inboxes", {
    method: "POST",
    body: {
      username: args.username,
      display_name: args.displayName,
    },
  });
}

export type SentMessage = { message_id: string; thread_id: string };

/** Sends one email from an agent inbox. */
export async function sendMessage(
  apiKey: string,
  inboxId: string,
  args: {
    to: string[];
    subject: string;
    text: string;
    replyTo?: string;
    inReplyTo?: string;
  },
): Promise<SentMessage> {
  const body: Record<string, unknown> = {
    to: args.to,
    subject: args.subject,
    text: args.text,
  };
  if (args.replyTo !== undefined) body.reply_to = [args.replyTo];
  if (args.inReplyTo !== undefined) body.in_reply_to = args.inReplyTo;

  return await call<SentMessage>(
    apiKey,
    `/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    { method: "POST", body },
  );
}

/** Points AgentMail at the Loomstate webhook so replies come back in. */
export async function createWebhook(
  apiKey: string,
  args: { url: string; inboxIds?: string[] },
): Promise<{ webhook_id: string; secret: string }> {
  return await call<{ webhook_id: string; secret: string }>(
    apiKey,
    "/webhooks",
    {
      method: "POST",
      body: {
        url: args.url,
        event_types: ["message.received"],
        ...(args.inboxIds === undefined ? {} : { inbox_ids: args.inboxIds }),
      },
    },
  );
}

/**
 * Verifies a Svix-signed webhook. AgentMail signs every delivery, so Loomstate
 * only acts on a body it can prove came from AgentMail.
 */
export async function verifyWebhook(
  secret: string,
  headers: { id: string; timestamp: string; signature: string },
  body: string,
): Promise<boolean> {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(raw);
    keyBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) keyBytes[i] = binary.charCodeAt(i);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${headers.id}.${headers.timestamp}.${body}`;
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signed),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // The header carries one or more space separated `v1,<signature>` pairs.
  return headers.signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((candidate) => timingSafeEqual(candidate, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
