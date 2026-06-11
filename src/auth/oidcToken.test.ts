import { describe, expect, it } from "vitest";
import { parseIntrospection } from "./oidcToken.ts";

describe("parseIntrospection", () => {
  it("reads an active token's claims", () => {
    const r = parseIntrospection({
      active: true,
      sub: "abc-123",
      email: "user@example.com",
      name: "A User",
      preferred_username: "auser",
      iss: "https://login.example.com/application/o/taimline/",
      exp: 1893456000,
    });
    expect(r).toEqual({
      active: true,
      sub: "abc-123",
      email: "user@example.com",
      name: "A User",
      preferredUsername: "auser",
      iss: "https://login.example.com/application/o/taimline/",
      exp: 1893456000,
    });
  });

  it("treats a missing/false active flag as inactive (no truthy coercion)", () => {
    expect(parseIntrospection({ active: false }).active).toBe(false);
    expect(parseIntrospection({}).active).toBe(false);
    expect(parseIntrospection({ active: "true" }).active).toBe(false); // must be boolean true
  });

  it("ignores wrong-typed fields", () => {
    const r = parseIntrospection({ active: true, sub: 123, exp: "soon" });
    expect(r.sub).toBeUndefined();
    expect(r.exp).toBeUndefined();
  });
});
