import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

// Server-side markdown rendering. Output is sanitized and cached in the DB
// (eras.description_html, posts.body_html) so reads never re-render or trust
// raw user HTML.

export interface MediaRef {
  url: string;
  kind: "image" | "video" | "other";
}
/** Resolve a markdown media reference (e.g. ![cap](beach-sunset)) to a URL. */
export type MediaResolver = (ref: string) => MediaRef | null;

const md = new MarkdownIt({
  html: false, // don't allow raw HTML in source; sanitize the rendered output anyway
  linkify: true,
  breaks: true,
});

// Custom image rule: if the src resolves to attached media, emit the real URL
// (and a <video> for video media); otherwise fall back to the default <img>.
const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  const resolver: MediaResolver | undefined = env?.resolver;
  const resolved = resolver?.(src);
  if (!resolved) return defaultImage(tokens, idx, options, env, self);

  const alt = md.utils.escapeHtml(token.content ?? "");
  const url = md.utils.escapeHtml(resolved.url);
  if (resolved.kind === "video") {
    return `<video src="${url}" controls preload="metadata"></video>`;
  }
  return `<img src="${url}" alt="${alt}" loading="lazy">`;
};

const ALLOWED_TAGS = [
  "p", "br", "hr", "blockquote", "pre", "code",
  "strong", "em", "del", "s", "u",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "a", "img",
  "video", "source",
  "table", "thead", "tbody", "tr", "th", "td",
];

export function renderMarkdown(
  source: string | null | undefined,
  resolver?: MediaResolver,
): string | null {
  if (!source || !source.trim()) return null;
  const rendered = md.render(source, { resolver });
  return sanitizeHtml(rendered, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title", "loading"],
      video: ["src", "controls", "preload", "width", "height"],
      source: ["src", "type"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    // Our resolved media URLs are app-relative (/api/media/...), which
    // sanitize-html permits by default (relative URLs are allowed).
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
  });
}
