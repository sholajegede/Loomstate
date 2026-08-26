import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { sha256Hex } from "./lib/hash";

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

export default http;
