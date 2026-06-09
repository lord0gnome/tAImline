import { describe, expect, it } from "vitest";
import { renderPostBody } from "./postRender.ts";

const media = [
  { id: "m1", name: "beach-sunset", mime: "image/jpeg" },
  { id: "m2", name: "clip", mime: "video/mp4" },
];

describe("renderPostBody media resolution", () => {
  it("resolves an image reference to the proxy URL as <img>", () => {
    const html = renderPostBody("![A sunset](beach-sunset)", media) ?? "";
    expect(html).toContain('<img src="/api/media/m1/raw"');
    expect(html).toContain('alt="A sunset"');
  });

  it("resolves a video reference to a <video> element", () => {
    const html = renderPostBody("![](clip)", media) ?? "";
    expect(html).toContain("<video");
    expect(html).toContain('src="/api/media/m2/raw"');
    expect(html).toContain("controls");
  });

  it("is case-insensitive on the reference name", () => {
    expect(renderPostBody("![](Beach-Sunset)", media) ?? "").toContain("/api/media/m1/raw");
  });

  it("passes external image URLs through untouched", () => {
    const html = renderPostBody("![x](https://example.com/a.png)", media) ?? "";
    expect(html).toContain('src="https://example.com/a.png"');
  });

  it("strips scripts / unknown tags from rendered markdown", () => {
    const html = renderPostBody("# Hi\n\n<script>alert(1)</script>", media) ?? "";
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).not.toContain("<script>");
  });

  it("returns null for empty body", () => {
    expect(renderPostBody("", media)).toBeNull();
  });
});
