import { describe, expect, it } from "vitest";
import {
  canViewEra,
  canViewPost,
  NO_GRANTS,
  resolveEraVisibility,
  resolvePostVisibility,
  type ViewerGrants,
} from "./authz.ts";

const owner: ViewerGrants = { isOwner: true, timelineGrant: false, eraGrants: new Set() };
const stranger = NO_GRANTS;
const timelineGuest: ViewerGrants = { isOwner: false, timelineGrant: true, eraGrants: new Set() };
const eraGuest = (id: string): ViewerGrants => ({
  isOwner: false,
  timelineGrant: false,
  eraGrants: new Set([id]),
});

describe("visibility resolution", () => {
  it("era inherit -> owner default", () => {
    expect(resolveEraVisibility("inherit", "public")).toBe("public");
    expect(resolveEraVisibility("private", "public")).toBe("private");
  });
  it("post inherit -> era effective, else owner default", () => {
    expect(resolvePostVisibility("inherit", "gated", "public")).toBe("gated");
    expect(resolvePostVisibility("inherit", null, "unlisted")).toBe("unlisted");
    expect(resolvePostVisibility("public", "private", "private")).toBe("public");
  });
});

describe("canViewEra", () => {
  const era = (visibility: "inherit" | "private" | "gated" | "unlisted" | "public") => ({
    id: "e1",
    visibility,
  });

  it("public/unlisted visible to everyone", () => {
    for (const v of ["public", "unlisted"] as const) {
      expect(canViewEra(era(v), "private", stranger)).toBe(true);
    }
  });
  it("private only to owner", () => {
    expect(canViewEra(era("private"), "public", owner)).toBe(true);
    expect(canViewEra(era("private"), "public", stranger)).toBe(false);
    expect(canViewEra(era("private"), "public", timelineGuest)).toBe(false);
  });
  it("gated: owner, timeline grant, or matching era grant", () => {
    expect(canViewEra(era("gated"), "private", owner)).toBe(true);
    expect(canViewEra(era("gated"), "private", stranger)).toBe(false);
    expect(canViewEra(era("gated"), "private", timelineGuest)).toBe(true);
    expect(canViewEra(era("gated"), "private", eraGuest("e1"))).toBe(true);
    expect(canViewEra(era("gated"), "private", eraGuest("other"))).toBe(false);
  });
  it("inherit follows owner default", () => {
    expect(canViewEra(era("inherit"), "public", stranger)).toBe(true);
    expect(canViewEra(era("inherit"), "private", stranger)).toBe(false);
  });
});

describe("canViewPost", () => {
  const post = (
    visibility: "inherit" | "private" | "gated" | "unlisted" | "public",
    eraId: string | null = "e1",
  ) => ({ eraId, visibility });

  it("explicit public post is visible even if era is private", () => {
    expect(canViewPost(post("public"), "private", "private", stranger)).toBe(true);
  });
  it("inherit post follows era effective visibility", () => {
    expect(canViewPost(post("inherit"), "private", "public", stranger)).toBe(false);
    expect(canViewPost(post("inherit"), "public", "private", stranger)).toBe(true);
  });
  it("gated post honored by era-scope grant on its era", () => {
    expect(canViewPost(post("gated", "e1"), null, "private", eraGuest("e1"))).toBe(true);
    expect(canViewPost(post("gated", "e2"), null, "private", eraGuest("e1"))).toBe(false);
  });
  it("free-floating gated post needs a timeline grant", () => {
    expect(canViewPost(post("gated", null), null, "private", eraGuest("e1"))).toBe(false);
    expect(canViewPost(post("gated", null), null, "private", timelineGuest)).toBe(true);
  });
});
