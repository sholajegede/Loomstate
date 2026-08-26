/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as blocklist from "../blocklist.js";
import type * as devices from "../devices.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_aliveness from "../lib/aliveness.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_url from "../lib/url.js";
import type * as loops from "../loops.js";
import type * as secrets from "../secrets.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  blocklist: typeof blocklist;
  devices: typeof devices;
  events: typeof events;
  http: typeof http;
  ingest: typeof ingest;
  "lib/access": typeof lib_access;
  "lib/aliveness": typeof lib_aliveness;
  "lib/crypto": typeof lib_crypto;
  "lib/hash": typeof lib_hash;
  "lib/openai": typeof lib_openai;
  "lib/url": typeof lib_url;
  loops: typeof loops;
  secrets: typeof secrets;
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
