import type { APIRoute } from "astro";
import {
  callTool,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOLS,
} from "~/lib/mcp.ts";
import type { users } from "~/db/schema.ts";

export const prerender = false;

type UserRow = typeof users.$inferSelect;

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: RpcMessage["id"], res: unknown) => ({ jsonrpc: "2.0", id, result: res });
const fail = (id: RpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** Handle one JSON-RPC message. Returns a response, or null for notifications. */
function handle(user: UserRow, msg: RpcMessage): object | null {
  const { id, method, params } = msg;
  const isNotification = id === undefined;

  switch (method) {
    case "initialize": {
      const requested =
        typeof params?.protocolVersion === "string"
          ? (params.protocolVersion as string)
          : MCP_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
      });
    }

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      const args =
        params?.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      const r = callTool(user, name, args);
      return ok(id, {
        content: [{ type: "text", text: r.text }],
        isError: r.isError ?? false,
      });
    }

    default:
      // Notifications (e.g. notifications/initialized) get no response.
      if (isNotification) return null;
      return fail(id, -32601, `Method not found: ${method ?? "(none)"}`);
  }
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="taimline"',
      },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }

  const messages = Array.isArray(body) ? (body as RpcMessage[]) : [body as RpcMessage];
  const responses = messages
    .map((m) => handle(locals.user!, m))
    .filter((r): r is object => r !== null);

  // Notifications-only batch → 202 with no body (per the Streamable HTTP spec).
  if (responses.length === 0) return new Response(null, { status: 202 });

  const payload = Array.isArray(body) ? responses : responses[0];
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
};

// We don't offer a server-initiated SSE stream; advertise that clearly.
export const GET: APIRoute = () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
