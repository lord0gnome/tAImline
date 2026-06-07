import type { users } from "~/db/schema.ts";
import {
  createEra,
  deleteEra,
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
import { attachMediaFromUrl } from "~/lib/media.ts";

type UserRow = typeof users.$inferSelect;

export const MCP_SERVER_INFO = { name: "taimline", version: "0.7.0" };
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
  category: { type: "string", description: "Optional grouping, e.g. 'Career'." },
  visibility,
  descriptionMd: { type: "string", description: "Markdown description / notes." },
};

const postProps = {
  title: { type: "string", description: "Moment title." },
  bodyMd: { type: "string", description: "Markdown story / body." },
  eraId: {
    type: ["string", "null"],
    description: "Id of the era this belongs to, or null/omitted if free-floating.",
  },
  eventDate: { type: "string", description: "Date of the moment as YYYY-MM-DD." },
  eventPrecision: { ...precision, description: "How precise the date is." },
  eventEndDate: {
    type: ["string", "null"],
    description: "End date YYYY-MM-DD for a span, or null/omitted for a point in time.",
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
      "Add a dated moment (markdown story) to the timeline, optionally attached to an era by id.",
    inputSchema: {
      type: "object",
      properties: postProps,
      required: ["title", "eventDate"],
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
];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const ok = (data: unknown): ToolResult => ({ text: JSON.stringify(data, null, 2) });
const err = (message: string): ToolResult => ({ text: message, isError: true });

type Args = Record<string, unknown>;

/** Execute a tool on behalf of `user`. Never throws; returns isError instead. */
export async function callTool(user: UserRow, name: string, args: Args): Promise<ToolResult> {
  switch (name) {
    case "get_profile":
      return ok({
        handle: user.handle,
        displayName: user.displayName,
        birthDate: user.birthDate,
        defaultVisibility: user.defaultVisibility,
      });

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
      const parsed = parsePost(args);
      if (!parsed.ok) return err(parsed.error);
      const r = createPost(user.id, parsed.value);
      return r.ok ? ok({ post: r.post }) : err(r.error);
    }

    case "update_post": {
      const id = typeof args.id === "string" ? args.id : "";
      const existing = getOwnedPost(user.id, id);
      if (!existing) return err(`Post not found: ${id}`);
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

    default:
      return err(`Unknown tool: ${name}`);
  }
}
