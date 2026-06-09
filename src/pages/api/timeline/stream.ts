import type { APIRoute } from "astro";
import { timelineVersion } from "~/lib/timelineVersion.ts";

export const prerender = false;

/** How often the server re-checks the timeline fingerprint (ms). */
const POLL_MS = 10_000;

/**
 * Server-Sent Events stream of "the timeline changed" notifications for the
 * signed-in user. One long-lived connection per tab; the server polls a cheap
 * fingerprint every {@link POLL_MS} and emits a `change` event only when it
 * actually moves — so the client refetches `/api/timeline` just when there's
 * something new, instead of polling itself. A keep-alive comment goes out each
 * tick so intermediaries (nginx) don't close the idle connection.
 */
export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return new Response("Not authenticated.", { status: 401 });
  const userId = locals.user.id;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = timelineVersion(userId);
      // Tell the client the current version up front (and prime EventSource).
      controller.enqueue(encoder.encode(`event: change\ndata: ${last}\n\n`));

      timer = setInterval(() => {
        try {
          const next = timelineVersion(userId);
          if (next !== last) {
            last = next;
            controller.enqueue(encoder.encode(`event: change\ndata: ${next}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          }
        } catch {
          // A transient DB error shouldn't tear the stream down; try next tick.
        }
      }, POLL_MS);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      // Disable proxy buffering so events flush immediately (nginx).
      "x-accel-buffering": "no",
    },
  });
};
