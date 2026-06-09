import { type MediaResolver, renderMarkdown } from "~/lib/markdown.ts";

export interface PostMediaRef {
  id: string;
  name: string | null;
  mime: string | null;
}

function kindOf(mime: string | null): "image" | "video" | "other" {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  return "other";
}

/**
 * Render a post body, resolving markdown media references (the clean per-post
 * `name`, e.g. ![cap](beach-sunset)) to the authz-checked proxy URL. Images
 * become <img>, videos become <video>. External URLs pass through untouched.
 */
export function renderPostBody(
  bodyMd: string | null | undefined,
  media: PostMediaRef[],
): string | null {
  const byName = new Map<string, ReturnType<MediaResolver>>();
  for (const m of media) {
    if (m.name) {
      byName.set(m.name.toLowerCase(), { url: `/api/media/${m.id}/raw`, kind: kindOf(m.mime) });
    }
  }
  const resolver: MediaResolver = (ref) => byName.get(ref.toLowerCase().trim()) ?? null;
  return renderMarkdown(bodyMd, resolver);
}
