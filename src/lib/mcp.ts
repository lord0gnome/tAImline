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

type UserRow = typeof users.$inferSelect;

export const MCP_SERVER_INFO = { name: "taimline", version: "0.3.0" };
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
];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const ok = (data: unknown): ToolResult => ({ text: JSON.stringify(data, null, 2) });
const err = (message: string): ToolResult => ({ text: message, isError: true });

type Args = Record<string, unknown>;

/** Execute a tool on behalf of `user`. Never throws; returns isError instead. */
export function callTool(user: UserRow, name: string, args: Args): ToolResult {
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

    default:
      return err(`Unknown tool: ${name}`);
  }
}
