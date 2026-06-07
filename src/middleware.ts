import { defineMiddleware } from "astro:middleware";
import {
  SESSION_COOKIE,
  deleteSessionCookie,
  setSessionCookie,
  validateSessionToken,
} from "~/auth/session.ts";
import { validateApiToken } from "~/auth/tokens.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.sessionId = null;

  const token = context.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (token) {
    const result = validateSessionToken(token);
    if (result) {
      context.locals.user = result.user;
      context.locals.sessionId = result.session.id;
      // Keep the cookie lifetime in step with the (sliding) session.
      setSessionCookie(context.cookies, token);
    } else {
      deleteSessionCookie(context.cookies);
    }
  }

  // Fall back to an API token (Authorization: Bearer …) for programmatic
  // clients (the MCP server, scripts). Tokens never get a session cookie.
  if (!context.locals.user) {
    const auth = context.request.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      const user = validateApiToken(auth.slice(7).trim());
      if (user) context.locals.user = user;
    }
  }

  return next();
});
