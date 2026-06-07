import { defineMiddleware } from "astro:middleware";
import {
  SESSION_COOKIE,
  deleteSessionCookie,
  setSessionCookie,
  validateSessionToken,
} from "~/auth/session.ts";

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

  return next();
});
