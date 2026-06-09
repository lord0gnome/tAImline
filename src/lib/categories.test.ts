import { describe, expect, it } from "vitest";
import { decodeCategories, parseCategories, serializeCategories } from "./categories.ts";

describe("parseCategories", () => {
  it("accepts an array, trimming and dropping empties", () => {
    expect(parseCategories([" Career ", "", "Travel", "  "])).toEqual(["Career", "Travel"]);
  });

  it("splits a comma-separated string", () => {
    expect(parseCategories("Career, Travel ,Family")).toEqual(["Career", "Travel", "Family"]);
  });

  it("dedupes case-insensitively, keeping first spelling", () => {
    expect(parseCategories(["Career", "career", "CAREER"])).toEqual(["Career"]);
  });

  it("ignores non-strings and non-array/string input", () => {
    expect(parseCategories([1, "ok", null, {}])).toEqual(["ok"]);
    expect(parseCategories(42)).toEqual([]);
    expect(parseCategories(null)).toEqual([]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    expect(parseCategories(many).length).toBe(16);
  });
});

describe("serialize/decode round-trip", () => {
  it("serializes to JSON and decodes back", () => {
    const cats = ["Career", "Travel"];
    const stored = serializeCategories(cats);
    expect(stored).toBe('["Career","Travel"]');
    expect(decodeCategories(stored)).toEqual(cats);
  });

  it("stores null for an empty list", () => {
    expect(serializeCategories([])).toBeNull();
    expect(decodeCategories(null)).toEqual([]);
  });

  it("tolerates a legacy bare-string value", () => {
    expect(decodeCategories("Career")).toEqual(["Career"]);
  });
});
