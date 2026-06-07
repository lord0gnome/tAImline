import { defineMiddleware } from "astro:middleware";

/**
 * Request middleware. For now it just establishes the auth shape on
 * `Astro.locals`; session-cookie resolution lands in M1 (auth).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.sessionId = null;
  return next();
});
