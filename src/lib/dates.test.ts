import { describe, expect, it } from "vitest";
import { formatByPrecision, formatSpan, isValidISODate, msToISO, toMs } from "./dates.ts";

describe("dates", () => {
  it("parses partial and full ISO to UTC ms", () => {
    expect(toMs("2009")).toBe(Date.UTC(2009, 0, 1));
    expect(toMs("2009-03")).toBe(Date.UTC(2009, 2, 1));
    expect(toMs("2009-03-12")).toBe(Date.UTC(2009, 2, 12));
  });

  it("round-trips ms <-> ISO", () => {
    const ms = Date.UTC(2015, 10, 30);
    expect(msToISO(ms)).toBe("2015-11-30");
  });

  it("formats according to precision", () => {
    expect(formatByPrecision("2009-03-12", "year")).toBe("2009");
    expect(formatByPrecision("2009-03-12", "month")).toBe("Mar 2009");
    expect(formatByPrecision("2009-03-12", "day")).toBe("12 Mar 2009");
  });

  it("formats spans with present for open ranges", () => {
    expect(formatSpan("2009-01-01", "year", null, null)).toBe("2009 – present");
    expect(formatSpan("2009-03-01", "month", "2012-06-01", "month")).toBe(
      "Mar 2009 – Jun 2012",
    );
  });

  it("validates ISO date strings", () => {
    expect(isValidISODate("2009-03-12")).toBe(true);
    expect(isValidISODate("2009-3-2")).toBe(false);
    expect(isValidISODate("not-a-date")).toBe(false);
  });
});
