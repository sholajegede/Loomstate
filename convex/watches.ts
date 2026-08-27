import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireDocIn, requireSession, requireWorkspaceWrite } from "./lib/access";
import { normalize, scrape } from "./lib/firecrawl";
import { findContactEmail } from "./lib/url";
import { askForJson } from "./lib/openai";
import { sha256Hex } from "./lib/hash";
import { resolveFirecrawlKey, resolveOpenAiKey } from "./secrets";
import { alivenessScore, statusFor } from "./lib/aliveness";

const DEFAULT_INTERVAL_MINUTES = 15;

const watchShape = v.object({
  _id: v.id("watches"),
  url: v.string(),
  label: v.string(),
  intervalMinutes: v.number(),
  active: v.boolean(),
  lastCrawlAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  price: v.optional(v.string()),
  availability: v.optional(v.string()),
  excerpt: v.optional(v.string()),
});

const diffShape = v.object({
  _id: v.id("diffs"),
  watchId: v.id("watches"),
  url: v.string(),
  kind: v.string(),
  field: v.string(),
  before: v.optional(v.string()),
  after: v.optional(v.string()),
  summary: v.string(),
  detectedAt: v.number(),
  seenAt: v.optional(v.number()),
});

/** The watches and detected changes for one loop. */
export const forLoop = query({
  args: { loopId: v.id("loops") },
  returns: v.object({
    watches: v.array(watchShape),
    diffs: v.array(diffShape),
  }),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    await requireDocIn(ctx, loop, "Loop");

    const watches = await ctx.db
      .query("watches")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect();

    const shaped = [];
    for (const watch of watches) {
      const snapshot =
        watch.lastSnapshotId === undefined
          ? null
          : await ctx.db.get(watch.lastSnapshotId);
      shaped.push({
        _id: watch._id,
        url: watch.url,
        label: watch.label,
        intervalMinutes: watch.intervalMinutes,
        active: watch.active,
        lastCrawlAt: watch.lastCrawlAt,
        lastError: watch.lastError,
        price: snapshot?.price,
        availability: snapshot?.availability,
        excerpt: snapshot?.excerpt,
      });
    }

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(30);

    const urlById = new Map(watches.map((w) => [w._id as string, w.url]));
    return {
      watches: shaped,
      diffs: diffs.map((d) => ({
        _id: d._id,
        watchId: d.watchId,
        url: urlById.get(d.watchId as string) ?? "",
        kind: d.kind,
        field: d.field,
        before: d.before,
        after: d.after,
        summary: d.summary,
        detectedAt: d.detectedAt,
        seenAt: d.seenAt,
      })),
    };
  },
});

/** Starts watching one page for a loop. */
export const create = mutation({
  args: {
    loopId: v.id("loops"),
    url: v.string(),
    label: v.optional(v.string()),
    intervalMinutes: v.optional(v.number()),
  },
  returns: v.id("watches"),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);

    let parsed: URL;
    try {
      parsed = new URL(args.url);
    } catch {
      throw new Error("Enter a full web address.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Loomstate watches web pages only.");
    }

    const existing = await ctx.db
      .query("watches")
      .withIndex("by_loop_url", (q) =>
        q.eq("loopId", args.loopId).eq("url", args.url),
      )
      .first();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { active: true });
      return existing._id;
    }

    const now = Date.now();
    const watchId = await ctx.db.insert("watches", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      url: args.url,
      label: args.label?.trim() || parsed.hostname.replace(/^www\./, ""),
      intervalMinutes: args.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
      active: true,
      createdAt: now,
    });

    await ctx.db.insert("auditLog", {
      workspaceId: loop.workspaceId,
      loopId: args.loopId,
      actorType: "user",
      action: "watch.create",
      detail: `The owner asked Loomstate to watch ${args.url}.`,
      at: now,
    });
    return watchId;
  },
});

/** Sets how often Loomstate re-reads a watched page. */
export const setInterval = mutation({
  args: { watchId: v.id("watches"), intervalMinutes: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (watch === null) throw new Error("Watch not found.");
    await requireWorkspaceWrite(ctx, watch.workspaceId);
    const minutes = Math.min(1440, Math.max(5, Math.round(args.intervalMinutes)));
    await ctx.db.patch(args.watchId, { intervalMinutes: minutes });
    return null;
  },
});

export const setActive = mutation({
  args: { watchId: v.id("watches"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (watch === null) throw new Error("Watch not found.");
    await requireWorkspaceWrite(ctx, watch.workspaceId);
    await ctx.db.patch(args.watchId, { active: args.active });
    return null;
  },
});

/** Marks the changes on a loop as read. */
export const markDiffsSeen = mutation({
  args: { loopId: v.id("loops") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    if (loop === null) throw new Error("Loop not found.");
    await requireWorkspaceWrite(ctx, loop.workspaceId);
    const now = Date.now();
    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_loop_time", (q) => q.eq("loopId", args.loopId))
      .order("desc")
      .take(50);
    for (const diff of diffs) {
      if (diff.seenAt === undefined) await ctx.db.patch(diff._id, { seenAt: now });
    }
    return null;
  },
});

// --- the sweep ------------------------------------------------------------

export const readWatch = internalQuery({
  args: { watchId: v.id("watches") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("watches"),
      workspaceId: v.id("workspaces"),
      loopId: v.id("loops"),
      url: v.string(),
      label: v.string(),
      lastSnapshot: v.union(
        v.null(),
        v.object({
          _id: v.id("snapshots"),
          contentHash: v.string(),
          title: v.optional(v.string()),
          price: v.optional(v.string()),
          availability: v.optional(v.string()),
          excerpt: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (watch === null) return null;
    const snapshot =
      watch.lastSnapshotId === undefined
        ? null
        : await ctx.db.get(watch.lastSnapshotId);
    return {
      _id: watch._id,
      workspaceId: watch.workspaceId,
      loopId: watch.loopId,
      url: watch.url,
      label: watch.label,
      lastSnapshot:
        snapshot === null
          ? null
          : {
              _id: snapshot._id,
              contentHash: snapshot.contentHash,
              title: snapshot.title,
              price: snapshot.price,
              availability: snapshot.availability,
              excerpt: snapshot.excerpt,
            },
    };
  },
});

export const dueWatches = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.id("watches")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const watches = await ctx.db
      .query("watches")
      .withIndex("by_active_crawl", (q) => q.eq("active", true))
      .take(200);
    return watches
      .filter(
        (w) =>
          w.lastCrawlAt === undefined ||
          now - w.lastCrawlAt >= w.intervalMinutes * 60_000,
      )
      .slice(0, args.limit ?? 10)
      .map((w) => w._id);
  },
});

const diffKind = v.union(
  v.literal("price"),
  v.literal("availability"),
  v.literal("content"),
  v.literal("gone"),
  v.literal("first_seen"),
);

/** Stores one reading of a watched page and any change it shows. */
export const recordSnapshot = internalMutation({
  args: {
    watchId: v.id("watches"),
    ok: v.boolean(),
    contentHash: v.string(),
    title: v.optional(v.string()),
    price: v.optional(v.string()),
    availability: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    excerpt: v.string(),
    error: v.optional(v.string()),
    changes: v.array(
      v.object({
        kind: diffKind,
        field: v.string(),
        before: v.optional(v.string()),
        after: v.optional(v.string()),
        summary: v.string(),
      }),
    ),
  },
  returns: v.object({ diffIds: v.array(v.id("diffs")) }),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (watch === null) return { diffIds: [] };
    const now = Date.now();

    const previousId = watch.lastSnapshotId;
    const snapshotId = await ctx.db.insert("snapshots", {
      workspaceId: watch.workspaceId,
      watchId: args.watchId,
      capturedAt: now,
      contentHash: args.contentHash,
      title: args.title,
      price: args.price,
      availability: args.availability,
      contactEmail: args.contactEmail,
      excerpt: args.excerpt,
      ok: args.ok,
    });

    // A contact read off the page clears the blocker that stopped the agent.
    if (args.contactEmail !== undefined) {
      const loop = await ctx.db.get(watch.loopId);
      if (loop !== null && loop.contactEmail !== args.contactEmail) {
        await ctx.db.patch(watch.loopId, {
          contactEmail: args.contactEmail,
          contactSource: watch.url,
          blockedReason: undefined,
        });
      }
    }

    await ctx.db.patch(args.watchId, {
      lastCrawlAt: now,
      lastError: args.error,
      ...(args.ok ? { lastSnapshotId: snapshotId } : {}),
    });

    const diffIds: Id<"diffs">[] = [];
    for (const change of args.changes) {
      const diffId = await ctx.db.insert("diffs", {
        workspaceId: watch.workspaceId,
        loopId: watch.loopId,
        watchId: args.watchId,
        fromSnapshotId: previousId,
        toSnapshotId: snapshotId,
        kind: change.kind,
        field: change.field,
        before: change.before,
        after: change.after,
        summary: change.summary,
        detectedAt: now,
      });
      diffIds.push(diffId);

      await ctx.db.insert("auditLog", {
        workspaceId: watch.workspaceId,
        loopId: watch.loopId,
        actorType: "system",
        action: "watch.change",
        detail: change.summary,
        evidence: [
          {
            watchId: args.watchId,
            diffId,
            url: watch.url,
            label: watch.label,
            before: change.before,
            after: change.after,
            observedAt: now,
          },
        ],
        at: now,
      });
    }

    // A real change on the live web pulls the loop back up the intent map.
    if (diffIds.length > 0 && args.changes.some((c) => c.kind !== "first_seen")) {
      const loop = await ctx.db.get(watch.loopId);
      if (loop !== null && loop.status !== "closed") {
        const unseen = (
          await ctx.db
            .query("diffs")
            .withIndex("by_loop_time", (q) => q.eq("loopId", watch.loopId))
            .order("desc")
            .take(20)
        ).filter((d) => d.seenAt === undefined).length;

        const aliveness = alivenessScore({
          lastActivityAt: loop.lastActivityAt,
          eventCount: loop.eventCount,
          totalDwellMs: 0,
          momentum: loop.aliveness / 100,
          unseenDiffs: unseen,
          now,
        });
        await ctx.db.patch(loop._id, {
          aliveness,
          status: statusFor(aliveness, false),
        });
      }
    }

    return { diffIds };
  },
});

const EXTRACT_SYSTEM = `You read one web page and report the facts a buyer or planner cares about.

Report only what the page states. Never guess a price. If the page does not state a field, return null for it.
availability is one of: available, sold, unavailable, unknown.
excerpt is one short sentence that says what this page offers right now.
contactEmail is the address a buyer would write to about this listing. Use only an address printed on the page. Return null for a site-wide address such as support@ or no-reply@, and null when the page prints none.`;

const EXTRACT_SCHEMA = {
  name: "page_facts",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "price", "availability", "contactEmail", "excerpt"],
    properties: {
      title: { type: ["string", "null"] },
      price: { type: ["string", "null"] },
      availability: {
        type: "string",
        enum: ["available", "sold", "unavailable", "unknown"],
      },
      contactEmail: { type: ["string", "null"] },
      excerpt: { type: "string" },
    },
  },
};

type PageFacts = {
  title: string | null;
  price: string | null;
  availability: string;
  contactEmail: string | null;
  excerpt: string;
};

type Change = {
  kind: "price" | "availability" | "content" | "gone" | "first_seen";
  field: string;
  before?: string;
  after?: string;
  summary: string;
};

/** Reads one watched page and records what changed since the last read. */
export const sweepOne = internalAction({
  args: { watchId: v.id("watches") },
  returns: v.object({
    ok: v.boolean(),
    changes: v.number(),
    detail: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; changes: number; detail: string }> => {
    const watch = await ctx.runQuery(internal.watches.readWatch, {
      watchId: args.watchId,
    });
    if (watch === null) return { ok: false, changes: 0, detail: "Watch is gone." };

    const firecrawlKey = await resolveFirecrawlKey(ctx, watch.workspaceId);
    const page = await scrape(firecrawlKey, watch.url);

    if (!page.ok) {
      const gone = watch.lastSnapshot !== null;
      await ctx.runMutation(internal.watches.recordSnapshot, {
        watchId: args.watchId,
        ok: false,
        contentHash: "",
        excerpt: "",
        error: page.error,
        changes: gone
          ? [
              {
                kind: "gone" as const,
                field: "page",
                summary:
                  `Loomstate cannot read ${watch.label} any more. ${page.error ?? ""}`.trim(),
              },
            ]
          : [],
      });
      return {
        ok: false,
        changes: gone ? 1 : 0,
        detail: page.error ?? "The read failed.",
      };
    }

    const normalized = normalize(page.markdown);
    const contentHash = await sha256Hex(normalized);

    // The page itself is the source of truth for where to write. Loomstate
    // reads it here so the person never has to look a seller up by hand.
    const scanned = findContactEmail(page.markdown);

    let facts: PageFacts = {
      title: page.title === "" ? null : page.title,
      price: null,
      availability: "unknown",
      contactEmail: scanned,
      excerpt: normalized.slice(0, 180),
    };
    try {
      const openAiKey = await resolveOpenAiKey(ctx, watch.workspaceId);
      const extracted = await askForJson<PageFacts>(openAiKey, {
        system: EXTRACT_SYSTEM,
        user: `Page: ${watch.url}\n\n${normalized.slice(0, 8000)}`,
        schema: EXTRACT_SCHEMA,
        reasoningEffort: "low",
      });
      facts = { ...extracted.value, contactEmail: extracted.value.contactEmail ?? scanned };
    } catch {
      // Without a key Loomstate still detects change by content hash.
    }

    const previous = watch.lastSnapshot;
    const changes: Change[] = [];

    if (previous === null) {
      changes.push({
        kind: "first_seen",
        field: "page",
        after: facts.price ?? facts.excerpt,
        summary: `Loomstate now watches ${watch.label}.${
          facts.price ? ` The price is ${facts.price}.` : ""
        }`,
      });
    } else {
      if ((previous.price ?? null) !== (facts.price ?? null)) {
        changes.push({
          kind: "price",
          field: "price",
          before: previous.price,
          after: facts.price ?? undefined,
          summary:
            facts.price === null
              ? `${watch.label} no longer shows a price.`
              : previous.price === undefined
                ? `${watch.label} now shows ${facts.price}.`
                : `The price on ${watch.label} moved from ${previous.price} to ${facts.price}.`,
        });
      }
      if ((previous.availability ?? "unknown") !== facts.availability) {
        changes.push({
          kind: "availability",
          field: "availability",
          before: previous.availability,
          after: facts.availability,
          summary: `${watch.label} is now ${facts.availability}.`,
        });
      }
      if (
        changes.length === 0 &&
        previous.contentHash !== "" &&
        previous.contentHash !== contentHash
      ) {
        changes.push({
          kind: "content",
          field: "page",
          before: previous.excerpt,
          after: facts.excerpt,
          summary: `The page ${watch.label} changed. ${facts.excerpt}`,
        });
      }
    }

    await ctx.runMutation(internal.watches.recordSnapshot, {
      watchId: args.watchId,
      ok: true,
      contentHash,
      title: facts.title ?? undefined,
      price: facts.price ?? undefined,
      availability: facts.availability,
      contactEmail: facts.contactEmail ?? undefined,
      excerpt: facts.excerpt.slice(0, 400),
      changes,
    });

    return {
      ok: true,
      changes: changes.length,
      detail:
        changes.length === 0
          ? `No change on ${watch.label}.`
          : changes.map((c) => c.summary).join(" "),
    };
  },
});

/** Reads every watch that is due. The scheduler calls this. */
export const sweepDue = internalAction({
  args: {},
  returns: v.object({ swept: v.number() }),
  handler: async (ctx): Promise<{ swept: number }> => {
    const watchIds = await ctx.runQuery(internal.watches.dueWatches, { limit: 10 });
    let changed = 0;
    for (const watchId of watchIds) {
      const result = await ctx.runAction(internal.watches.sweepOne, { watchId });
      changed += result.changes;
    }
    console.log(
      `sweep: read ${watchIds.length} watches, found ${changed} changes`,
    );
    return { swept: watchIds.length };
  },
});

export const watchIdsForLoop = internalQuery({
  args: { loopId: v.id("loops") },
  returns: v.array(v.id("watches")),
  handler: async (ctx, args) => {
    const loop = await ctx.db.get(args.loopId);
    await requireDocIn(ctx, loop, "Loop");
    const watches = await ctx.db
      .query("watches")
      .withIndex("by_loop", (q) => q.eq("loopId", args.loopId))
      .collect();
    return watches.filter((w) => w.active).map((w) => w._id);
  },
});

export const assertAccess = internalQuery({
  args: { watchId: v.id("watches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (watch === null) throw new Error("Watch not found.");
    const { workspace } = await requireSession(ctx);
    if (watch.workspaceId !== workspace._id) {
      throw new Error("No access to this watch.");
    }
    return null;
  },
});

/** Reads one watch now, on the owner's request. */
export const checkNow = action({
  args: { watchId: v.id("watches") },
  returns: v.object({ ok: v.boolean(), changes: v.number(), detail: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; changes: number; detail: string }> => {
    await assertCanTouchWatch(ctx, args.watchId);
    return await ctx.runAction(internal.watches.sweepOne, {
      watchId: args.watchId,
    });
  },
});

/** Reads every watch on one loop now. */
export const checkLoopNow = action({
  args: { loopId: v.id("loops") },
  returns: v.object({
    checked: v.number(),
    changes: v.number(),
    detail: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ checked: number; changes: number; detail: string }> => {
    const watchIds: Id<"watches">[] = await ctx.runQuery(
      internal.watches.watchIdsForLoop,
      { loopId: args.loopId },
    );
    let changes = 0;
    const lines: string[] = [];
    for (const watchId of watchIds) {
      const result = await ctx.runAction(internal.watches.sweepOne, { watchId });
      changes += result.changes;
      lines.push(result.detail);
    }
    return {
      checked: watchIds.length,
      changes,
      detail: watchIds.length === 0 ? "This loop has no watch yet." : lines.join(" "),
    };
  },
});

async function assertCanTouchWatch(
  ctx: ActionCtx,
  watchId: Id<"watches">,
): Promise<void> {
  await ctx.runQuery(internal.watches.assertAccess, { watchId });
}
