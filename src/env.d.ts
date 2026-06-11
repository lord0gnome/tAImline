/// <reference path="../.astro/types.d.ts" />

import type { users } from "./db/schema.ts";

type UserRow = typeof users.$inferSelect;

declare global {
  namespace App {
    interface Locals {
      /** Authenticated user for the request, or null. Set by middleware (M1). */
      user: UserRow | null;
      /** Active session id (hashed), or null. */
      sessionId: string | null;
      /** Whether the authenticated user is an admin (email ∈ ADMIN_EMAILS). */
      isAdmin: boolean;
    }
  }
}

export {};
