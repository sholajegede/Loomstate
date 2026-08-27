/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agents from "../agents.js";
import type * as approvals from "../approvals.js";
import type * as auditLog from "../auditLog.js";
import type * as auth from "../auth.js";
import type * as autopilot from "../autopilot.js";
import type * as blocklist from "../blocklist.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as email from "../email.js";
import type * as events from "../events.js";
import type * as grants from "../grants.js";
import type * as http from "../http.js";
import type * as inbound from "../inbound.js";
import type * as ingest from "../ingest.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_agentmail from "../lib/agentmail.js";
import type * as lib_aliveness from "../lib/aliveness.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_firecrawl from "../lib/firecrawl.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_url from "../lib/url.js";
import type * as loops from "../loops.js";
import type * as notifications from "../notifications.js";
import type * as secrets from "../secrets.js";
import type * as site from "../site.js";
import type * as watches from "../watches.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agents: typeof agents;
  approvals: typeof approvals;
  auditLog: typeof auditLog;
  auth: typeof auth;
  autopilot: typeof autopilot;
  blocklist: typeof blocklist;
  crons: typeof crons;
  devices: typeof devices;
  email: typeof email;
  events: typeof events;
  grants: typeof grants;
  http: typeof http;
  inbound: typeof inbound;
  ingest: typeof ingest;
  "lib/access": typeof lib_access;
  "lib/agentmail": typeof lib_agentmail;
  "lib/aliveness": typeof lib_aliveness;
  "lib/crypto": typeof lib_crypto;
  "lib/firecrawl": typeof lib_firecrawl;
  "lib/hash": typeof lib_hash;
  "lib/openai": typeof lib_openai;
  "lib/url": typeof lib_url;
  loops: typeof loops;
  notifications: typeof notifications;
  secrets: typeof secrets;
  site: typeof site;
  watches: typeof watches;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
