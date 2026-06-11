import type { users } from "~/db/schema.ts";

type UserRow = typeof users.$inferSelect;

/**
 * Admin is determined by ADMIN_EMAILS (comma/space-separated, case-insensitive)
 * — a declarative allowlist living in the deploy secret. Keeping it in env (not
 * the DB) means it survives DB resets and you can't lock yourself out of the
 * admin settings. Evaluated per request, so adding/removing an email takes
 * effect on the user's next request.
 */
export function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.toLowerCase());
}

export function isAdmin(user: UserRow | null | undefined): boolean {
  return isAdminEmail(user?.email ?? null);
}
