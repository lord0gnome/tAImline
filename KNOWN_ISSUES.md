# Known issues

## BUG-1 — Logout POST rejected: "Cross-site POST form submissions are forbidden"

**Symptom:** clicking **Sign out** (POST `/logout`) returns Astro's CSRF error
*"Cross-site POST form submissions are forbidden"* when running behind the
nginx-ingress on `https://taimline.morill.es`.

**Likely cause:** Astro 6's default `security.checkOrigin` compares the request
`Origin` header against the host; behind the TLS-terminating reverse proxy the
forwarded `Origin`/`Host` don't line up, so the same-site POST is treated as
cross-site.

**Candidate fixes (not yet applied):**
- Ensure the ingress forwards the original `Host`/`Origin` (it already sets
  `use-forwarded-headers`); verify what Astro actually sees.
- Or disable Astro's built-in check (`security: { checkOrigin: false }`) and add
  our own CSRF token to the logout form.
- Or make logout a same-origin `fetch()` POST with appropriate headers.

Status: deferred (noted 2026-06-07). Login/session flow otherwise works.

## BUG-2 — Can't delete eras

**Symptom:** deleting an era from the editor (DELETE `/api/eras/:id`) doesn't
work on the deployed app.

**Likely cause:** almost certainly the same root cause as BUG-1 — Astro's
`security.checkOrigin` CSRF guard rejecting a state-changing request behind the
TLS-terminating ingress (the `DELETE` is sent without an `application/json`
content-type, so unlike the JSON `fetch` POSTs it isn't exempt from the check).
JSON-content-type mutations (era create/update, the MCP endpoint) are unaffected,
which is why those work.

**Candidate fixes (not yet applied):** same as BUG-1 — verify the `Origin`/`Host`
the app sees behind nginx; either fix forwarded headers, disable `checkOrigin`
and add our own CSRF token, or send the DELETE as a JSON `fetch` with an explicit
content-type. Worth fixing BUG-1 + BUG-2 together (shared root cause).

Status: deferred (noted 2026-06-07).
