import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

// Server-side markdown rendering. Output is sanitized and cached in the DB
// (eras.description_html, posts.body_html) so reads never re-render or trust
// raw user HTML.

const md = new MarkdownIt({
  html: false, // don't allow raw HTML in source; sanitize the rendered output anyway
  linkify: true,
  breaks: true,
});

const ALLOWED_TAGS = [
  "p", "br", "hr", "blockquote", "pre", "code",
  "strong", "em", "del", "s", "u",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
];

export function renderMarkdown(source: string | null | undefined): string | null {
  if (!source || !source.trim()) return null;
  const rendered = md.render(source);
  return sanitizeHtml(rendered, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      // Make user links safe + non-referrer-leaking.
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
  });
}
