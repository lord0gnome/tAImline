import type { APIRoute } from "astro";

export const prerender = false;

// Liveness/readiness probe target for Kubernetes. Cheap and dependency-free.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
