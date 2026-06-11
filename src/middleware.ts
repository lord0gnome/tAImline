import { defineMiddleware } from "astro:middleware";
import {
  SESSION_COOKIE,
  deleteSessionCookie,
  setSessionCookie,
  validateSessionToken,
} from "~/auth/session.ts";
import { validateOidcAccessToken } from "~/auth/oidcToken.ts";
import { validateApiToken } from "~/auth/tokens.ts";
import { isAdmin } from "~/lib/admin.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.sessionId = null;
  context.locals.isAdmin = false;

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

  // Fall back to a bearer token (Authorization: Bearer …) for programmatic
  // clients. Two kinds: a taimline API token (tai_…, scripts / a single user's
  // MCP), or an OIDC access token from the configured provider — the latter
  // lets each Open WebUI user drive the MCP as themselves via OAuth. Bearer
  // clients never get a session cookie.
  if (!context.locals.user) {
    const auth = context.request.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      const raw = auth.slice(7).trim();
      const user = validateApiToken(raw) ?? (await validateOidcAccessToken(raw));
      if (user) context.locals.user = user;
    }
  }

  context.locals.isAdmin = isAdmin(context.locals.user);

  return next();
});
