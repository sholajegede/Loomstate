import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { sha256Hex } from "./lib/hash";
import { verifyWebhook } from "./lib/agentmail";
import { resolveWebhookSecret } from "./email";

const http = httpRouter();
auth.addHttpRoutes(http);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Reads the device token from the Authorization header. */
async function resolveDevice(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token === "") return null;
  return { tokenHash: await sha256Hex(token) };
}

const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS }));

http.route({ path: "/x/events", method: "OPTIONS", handler: preflight });
http.route({ path: "/x/state", method: "OPTIONS", handler: preflight });
http.route({ path: "/x/notifications", method: "OPTIONS", handler: preflight });

/** The extension posts browsing events here. */
http.route({
  path: "/x/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await resolveDevice(request);
    if (auth === null) return json({ error: "Missing device token." }, 401);

    const device = await ctx.runQuery(internal.ingest.deviceByTokenHash, auth);
    if (device === null) return json({ error: "Unknown or stopped device." }, 401);

    let body: { events?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }
    if (!Array.isArray(body.events)) {
      return json({ error: "Body needs an events array." }, 400);
    }
    if (body.events.length > 100) {
      return json({ error: "Send at most 100 events per batch." }, 400);
    }

    const result = await ctx.runMutation(internal.ingest.recordEvents, {
      deviceId: device.deviceId,
      workspaceId: device.workspaceId,
      events: body.events as never,
    });
    return json(result);
  }),
});

/** The extension popup reads its counts here. */
http.route({
  path: "/x/state",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await resolveDevice(request);
    if (auth === null) return json({ error: "Missing device token." }, 401);

    const device = await ctx.runQuery(internal.ingest.deviceByTokenHash, auth);
    if (device === null) return json({ error: "Unknown or stopped device." }, 401);

    const state = await ctx.runQuery(internal.ingest.popupState, {
      workspaceId: device.workspaceId,
    });
    return json(state);
  }),
});

/**
 * The extension drains waiting notifications here and raises each one as a
 * browser notification. Loomstate marks them delivered so they show once.
 */
http.route({
  path: "/x/notifications",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await resolveDevice(request);
    if (auth === null) return json({ error: "Missing device token." }, 401);

    const device = await ctx.runQuery(internal.ingest.deviceByTokenHash, auth);
    if (device === null) return json({ error: "Unknown or stopped device." }, 401);

    const pending = await ctx.runQuery(internal.notifications.pendingFor, {
      workspaceId: device.workspaceId,
    });
    if (pending.length > 0) {
      await ctx.runMutation(internal.notifications.markDelivered, {
        ids: pending.map((n) => n._id),
      });
    }

    return json({
      notifications: pending.map((n) => ({
        id: n._id,
        title: n.title,
        body: n.body,
        url: n.url,
      })),
    });
  }),
});

/** AgentMail posts every reply here. Loomstate verifies the signature first. */
http.route({
  path: "/x/agentmail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();

    let event: {
      event_type?: string;
      message?: {
        inbox_id?: string;
        from_?: string[] | string;
        to?: string[] | string;
        subject?: string;
        text?: string;
        thread_id?: string;
        message_id?: string;
      };
    };
    try {
      event = JSON.parse(body);
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }

    if (event.event_type !== "message.received" || event.message === undefined) {
      return json({ ignored: true });
    }

    const message = event.message;
    const from = Array.isArray(message.from_)
      ? (message.from_[0] ?? "")
      : (message.from_ ?? "");
    const to = Array.isArray(message.to)
      ? message.to
      : message.to === undefined
        ? []
        : [message.to];

    if (message.inbox_id === undefined || from === "") {
      return json({ error: "The event has no inbox or sender." }, 400);
    }

    // Find who owns the inbox, then prove the delivery with that workspace's
    // signing secret. Loomstate reads the body first but acts only after this.
    const owner = await ctx.runQuery(internal.agents.inboxOwner, {
      inboxId: message.inbox_id,
    });
    if (owner === null) return json({ ignored: true, reason: "Unknown inbox." });

    const secret = await resolveWebhookSecret(ctx, owner.workspaceId);
    if (secret === null) {
      return json({ error: "Loomstate has no signing secret for this workspace." }, 401);
    }
    const verified = await verifyWebhook(
      secret,
      {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      body,
    );
    if (!verified) return json({ error: "Bad signature." }, 401);

    const result = await ctx.runAction(internal.inbound.handleReply, {
      inboxId: message.inbox_id,
      from,
      to,
      subject: message.subject ?? "(no subject)",
      text: message.text ?? "",
      threadId: message.thread_id,
      providerMessageId: message.message_id,
    });
    return json(result);
  }),
});

// --- the web app ----------------------------------------------------------

/** Reads one built file out of storage. Falls back to the app shell. */
function servePath(useAppShell: boolean) {
  return httpAction(async (ctx, request) => {
    const path = new URL(request.url).pathname;
    const direct = await ctx.runQuery(internal.site.readAsset, { path });
    const asset =
      direct ??
      (useAppShell
        ? await ctx.runQuery(internal.site.readAsset, { path: "/index.html" })
        : null);

    if (asset === null) {
      return new Response("Not found.", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const file = await ctx.storage.get(asset.storageId);
    if (file === null) {
      return new Response("The web app is not published yet.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Vite puts a content hash in every asset name, so those never change under
    // one URL. The app shell must stay fresh so a publish reaches open tabs.
    const immutable = path.startsWith("/assets/") && direct !== null;
    return new Response(file, {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
      },
    });
  });
}

/** Receives the built files on publish. The token lives in the server env. */
http.route({
  path: "/x/site-upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.SITE_UPLOAD_TOKEN;
    if (expected === undefined || expected === "") {
      return json({ error: "Publishing is not enabled on this deployment." }, 403);
    }
    const header = request.headers.get("Authorization") ?? "";
    if (header !== `Bearer ${expected}`) {
      return json({ error: "Bad publish token." }, 401);
    }

    const path = request.headers.get("x-asset-path") ?? "";
    if (!path.startsWith("/")) {
      return json({ error: "x-asset-path must start with a slash." }, 400);
    }

    const blob = await request.blob();
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.site.putAsset, {
      path,
      storageId,
      contentType:
        request.headers.get("x-asset-type") ?? "application/octet-stream",
      size: blob.size,
    });
    return json({ path, size: blob.size });
  }),
});

// The app shell answers every page route. Assets answer only their own path.
for (const path of ["/", "/signal", "/approvals", "/audit", "/settings"]) {
  http.route({ path, method: "GET", handler: servePath(true) });
}
http.route({ pathPrefix: "/loops/", method: "GET", handler: servePath(true) });
http.route({ pathPrefix: "/assets/", method: "GET", handler: servePath(false) });
http.route({ path: "/loom.svg", method: "GET", handler: servePath(false) });

export default http;
