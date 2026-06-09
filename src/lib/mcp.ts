import type { users } from "~/db/schema.ts";
import {
  createEra,
  deleteEra,
  getEraBySlug,
  getEraByTitle,
  getOwnedEra,
  listErasForUser,
  parseEra,
  toEraDTO,
  updateEra,
} from "~/lib/eras.ts";
import {
  createPost,
  deletePost,
  getOwnedPost,
  listPostsForUser,
  parsePost,
  toPostDTO,
  updatePost,
} from "~/lib/posts.ts";
import { attachMediaFromUrl, deleteMedia, getOwnedMedia, listMediaByPost } from "~/lib/media.ts";
import { getProfile, updateProfile } from "~/lib/profile.ts";
import { createShare, listShares, revokeShare } from "~/lib/shares.ts";

type UserRow = typeof users.$inferSelect;

export const MCP_SERVER_INFO = { name: "taimline", version: "0.16.0" };
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const precision = { type: "string", enum: ["year", "month", "day"] };
const visibility = {
  type: "string",
  enum: ["inherit", "private", "gated", "unlisted", "public"],
};

const eraProps = {
  title: { type: "string", description: "Era title, e.g. 'University'." },
  startDate: { type: "string", description: "Start date as YYYY-MM-DD." },
  startPrecision: { ...precision, description: "How precise the start is." },
  endDate: {
    type: ["string", "null"],
    description: "End date YYYY-MM-DD, or null/omitted if ongoing.",
  },
  endPrecision: precision,
  color: { type: "string", description: "Hex color like #4a6fa5." },
  categories: {
    type: "array",
    items: { type: "string" },
    description: "Tag-like groupings, e.g. ['Career', 'Travel']. Free-form.",
  },
  visibility,
  descriptionMd: { type: "string", description: "Markdown description / notes." },
};

const postProps = {
  title: { type: "string", description: "Moment title." },
  bodyMd: { type: "string", description: "Markdown story / body." },
  eraId: {
    type: ["string", "null"],
    description:
      "UUID of the era this moment belongs to. Prefer eraSlug or eraTitle for convenience; if multiple are given, eraId takes priority. Null/omitted = free-floating.",
  },
  eraSlug: {
    type: ["string", "null"],
    description:
      "Slug of the era (e.g. 'university'). Resolved server-side to eraId. Use list_timeline to discover slugs.",
  },
  eraTitle: {
    type: ["string", "null"],
    description:
      "Exact title of the era (case-insensitive, e.g. 'University'). Resolved server-side to eraId.",
  },
  eventDate: { type: "string", description: "Date of the moment as YYYY-MM-DD." },
  eventPrecision: { ...precision, description: "How precise the date is." },
  eventEndDate: {
    type: ["string", "null"],
    description: "End date YYYY-MM-DD for a span, or null/omitted for a point in time.",
  },
  categories: {
    type: "array",
    items: { type: "string" },
    description: "Tag-like groupings, e.g. ['Career', 'Travel']. Free-form.",
  },
  visibility,
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "get_profile",
    description:
      "Get the current user's profile (handle, display name, birth date, default visibility). Call this first for context.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_timeline",
    description:
      "List the user's eras (chapters of their life), optionally limited to those overlapping a date window.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Window start YYYY-MM-DD (optional)." },
        to: { type: "string", description: "Window end YYYY-MM-DD (optional)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "update_profile",
    description:
      "Update the user's profile: displayName, handle, bio, birthDate (timeline anchor, YYYY-MM-DD), defaultVisibility.",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string" },
        handle: { type: "string", description: "Public URL handle (a-z0-9-_)." },
        bio: { type: "string" },
        birthDate: { type: ["string", "null"], description: "YYYY-MM-DD or null." },
        defaultVisibility: {
          type: "string",
          enum: ["private", "gated", "unlisted", "public"],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_era",
    description:
      "Create a new era on the user's timeline. Eras may overlap; they stack into lanes automatically.",
    inputSchema: {
      type: "object",
      properties: eraProps,
      required: ["title", "startDate"],
      additionalProperties: false,
    },
  },
  {
    name: "create_eras",
    description:
      "Create MANY eras in one call. Pass an array; each is created independently and per-item errors are reported.",
    inputSchema: {
      type: "object",
      properties: {
        eras: {
          type: "array",
          description: "Eras to create.",
          items: { type: "object", properties: eraProps, required: ["title", "startDate"] },
        },
      },
      required: ["eras"],
      additionalProperties: false,
    },
  },
  {
    name: "update_era",
    description: "Update an existing era by id. Provide the full intended set of fields.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...eraProps },
      required: ["id", "title", "startDate"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_era",
    description: "Delete an era by id. This cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_posts",
    description: "List the user's posts (moments), optionally within a date window.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Window start YYYY-MM-DD (optional)." },
        to: { type: "string", description: "Window end YYYY-MM-DD (optional)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_post",
    description:
      "Add a dated moment (markdown story) to the timeline, optionally attached to an era. " +
      "To attach, pass ONE of: eraId (UUID), eraSlug (e.g. 'university'), or eraTitle (e.g. 'University') — " +
      "the server resolves slug/title to the id automatically. Omit all three for a free-floating moment. " +
      "Reference attached media in the body as ![caption](name).",
    inputSchema: {
      type: "object",
      properties: postProps,
      required: ["title", "eventDate"],
      additionalProperties: false,
    },
  },
  {
    name: "create_posts",
    description:
      "Create MANY moments in one call. Each item may attach to an era via eraId, eraSlug, or eraTitle " +
      "(same resolution rules as create_post). Items are created independently; per-item errors are reported.",
    inputSchema: {
      type: "object",
      properties: {
        posts: {
          type: "array",
          description: "Moments to create.",
          items: { type: "object", properties: postProps, required: ["title", "eventDate"] },
        },
      },
      required: ["posts"],
      additionalProperties: false,
    },
  },
  {
    name: "update_post",
    description: "Update a moment by id. Provide the full intended set of fields.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...postProps },
      required: ["id", "title", "eventDate"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_post",
    description: "Delete a moment by id. This cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "attach_media_by_url",
    description:
      "Attach an image or video to a moment (post) by URL. The file is fetched and stored in the user's media bucket. Max 50 MB.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Id of the moment to attach to." },
        url: { type: "string", description: "Public URL of the image/video." },
        alt: { type: "string", description: "Alt text (optional)." },
        caption: { type: "string", description: "Caption (optional)." },
      },
      required: ["postId", "url"],
      additionalProperties: false,
    },
  },
  {
    name: "list_media",
    description: "List the media (images/videos) attached to a moment, with their reference names.",
    inputSchema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_media",
    description: "Delete a media item by id (removes it from storage too).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_shares",
    description: "List who the user's timeline / eras are shared with.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_share",
    description:
      "Grant access to a gated era or the whole timeline, to a registered user (granteeHandle) or by email invite (inviteEmail).",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["timeline", "era"] },
        eraId: { type: ["string", "null"], description: "Required when scope is 'era'." },
        granteeHandle: { type: "string", description: "Existing user's handle (without @)." },
        inviteEmail: { type: "string", description: "Email to invite (claimed on signup)." },
      },
      required: ["scope"],
      additionalProperties: false,
    },
  },
  {
    name: "revoke_share",
    description: "Revoke a share grant by its id (from list_shares).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const ok = (data: unknown): ToolResult => ({ text: JSON.stringify(data, null, 2) });
const err = (message: string): ToolResult => ({ text: message, isError: true });

type Args = Record<string, unknown>;

/**
 * Resolve the era reference in a post's args. Accepts eraId (UUID), eraSlug,
 * or eraTitle — in that priority order. Mutates `args.eraId` in-place so
 * downstream `parsePost` always sees a UUID (or null).
 * Returns an error string if the lookup fails, null on success.
 */
function resolvePostEra(userId: string, args: Args): string | null {
  // eraId takes priority — if it's a non-empty string, trust it directly.
  if (typeof args.eraId === "string" && args.eraId.trim()) return null;

  const slug = typeof args.eraSlug === "string" ? args.eraSlug.trim() : "";
  if (slug) {
    const row = getEraBySlug(userId, slug);
    if (!row) return `No era found with slug "${slug}".`;
    args.eraId = row.id;
    return null;
  }

  const title = typeof args.eraTitle === "string" ? args.eraTitle.trim() : "";
  if (title) {
    const row = getEraByTitle(userId, title);
    if (!row) return `No era found with title "${title}".`;
    args.eraId = row.id;
    return null;
  }

  return null; // no era reference at all — free-floating
}

/** Execute a tool on behalf of `user`. Never throws; returns isError instead. */
export async function callTool(user: UserRow, name: string, args: Args): Promise<ToolResult> {
  switch (name) {
    case "get_profile":
      return ok(getProfile(user.id));

    case "update_profile": {
      const r = updateProfile(user.id, args);
      return r.ok ? ok({ profile: r.profile }) : err(r.error);
    }

    case "list_timeline": {
      const from = typeof args.from === "string" ? args.from : undefined;
      const to = typeof args.to === "string" ? args.to : undefined;
      const range = from && to ? { from, to } : undefined;
      return ok({ eras: listErasForUser(user.id, range) });
    }

    case "create_era": {
      const parsed = parseEra(args);
      if (!parsed.ok) return err(parsed.error);
      return ok({ era: createEra(user.id, parsed.value) });
    }

    case "create_eras": {
      const list = Array.isArray(args.eras) ? (args.eras as Args[]) : null;
      if (!list) return err("`eras` must be an array.");
      const created: unknown[] = [];
      const errors: { index: number; error: string }[] = [];
      list.forEach((item, index) => {
        const parsed = parseEra(item);
        if (!parsed.ok) errors.push({ index, error: parsed.error });
        else created.push(createEra(user.id, parsed.value));
      });
      return { text: JSON.stringify({ created, errors }, null, 2), isError: errors.length > 0 };
    }

    case "update_era": {
      const id = typeof args.id === "string" ? args.id : "";
      const existing = getOwnedEra(user.id, id);
      if (!existing) return err(`Era not found: ${id}`);
      const parsed = parseEra(args);
      if (!parsed.ok) return err(parsed.error);
      return ok({ era: updateEra(existing, parsed.value) });
    }

    case "delete_era": {
      const id = typeof args.id === "string" ? args.id : "";
      const existing = getOwnedEra(user.id, id);
      if (!existing) return err(`Era not found: ${id}`);
      deleteEra(existing.id);
      return ok({ deleted: toEraDTO(existing).id });
    }

    case "list_posts": {
      const from = typeof args.from === "string" ? args.from : undefined;
      const to = typeof args.to === "string" ? args.to : undefined;
      const range = from && to ? { from, to } : undefined;
      return ok({ posts: listPostsForUser(user.id, range) });
    }

    case "create_post": {
      const eraErr = resolvePostEra(user.id, args);
      if (eraErr) return err(eraErr);
      const parsed = parsePost(args);
      if (!parsed.ok) return err(parsed.error);
      const r = createPost(user.id, parsed.value);
      return r.ok ? ok({ post: r.post }) : err(r.error);
    }

    case "create_posts": {
      const list = Array.isArray(args.posts) ? (args.posts as Args[]) : null;
      if (!list) return err("`posts` must be an array.");
      const created: unknown[] = [];
      const errors: { index: number; error: string }[] = [];
      list.forEach((item, index) => {
        const eraErr = resolvePostEra(user.id, item);
        if (eraErr) { errors.push({ index, error: eraErr }); return; }
        const parsed = parsePost(item);
        if (!parsed.ok) {
          errors.push({ index, error: parsed.error });
          return;
        }
        const r = createPost(user.id, parsed.value);
        if (r.ok) created.push(r.post);
        else errors.push({ index, error: r.error });
      });
      return { text: JSON.stringify({ created, errors }, null, 2), isError: errors.length > 0 };
    }

    case "update_post": {
      const id = typeof args.id === "string" ? args.id : "";
      const existing = getOwnedPost(user.id, id);
      if (!existing) return err(`Post not found: ${id}`);
      const eraErr = resolvePostEra(user.id, args);
      if (eraErr) return err(eraErr);
      const parsed = parsePost(args);
      if (!parsed.ok) return err(parsed.error);
      const r = updatePost(existing, parsed.value);
      return r.ok ? ok({ post: r.post }) : err(r.error);
    }

    case "delete_post": {
      const id = typeof args.id === "string" ? args.id : "";
      const existing = getOwnedPost(user.id, id);
      if (!existing) return err(`Post not found: ${id}`);
      deletePost(existing.id);
      return ok({ deleted: toPostDTO(existing).id });
    }

    case "attach_media_by_url": {
      const postId = typeof args.postId === "string" ? args.postId : "";
      const url = typeof args.url === "string" ? args.url : "";
      if (!postId || !url) return err("postId and url are required.");
      const r = await attachMediaFromUrl(user.id, {
        postId,
        url,
        alt: typeof args.alt === "string" ? args.alt : null,
        caption: typeof args.caption === "string" ? args.caption : null,
      });
      return r.ok ? ok({ media: r.media }) : err(r.error);
    }

    case "list_media": {
      const postId = typeof args.postId === "string" ? args.postId : "";
      if (!getOwnedPost(user.id, postId)) return err(`Post not found: ${postId}`);
      return ok({ media: listMediaByPost(user.id, postId) });
    }

    case "delete_media": {
      const id = typeof args.id === "string" ? args.id : "";
      const row = getOwnedMedia(user.id, id);
      if (!row) return err(`Media not found: ${id}`);
      await deleteMedia(row);
      return ok({ deleted: id });
    }

    case "list_shares":
      return ok({ shares: listShares(user.id) });

    case "create_share": {
      const r = createShare(user.id, args);
      return r.ok ? ok({ id: r.id }) : err(r.error);
    }

    case "revoke_share": {
      const id = typeof args.id === "string" ? args.id : "";
      return revokeShare(user.id, id) ? ok({ revoked: id }) : err(`Share not found: ${id}`);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
