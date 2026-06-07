import { describe, expect, it } from "vitest";
import { packLanes } from "./layout.ts";

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe("packLanes", () => {
  it("puts non-overlapping eras on the same lane", () => {
    const r = packLanes([
      { id: "a", startMs: ms("2000-01-01"), endMs: ms("2001-01-01") },
      { id: "b", startMs: ms("2001-01-01"), endMs: ms("2002-01-01") },
      { id: "c", startMs: ms("2002-06-01"), endMs: ms("2003-01-01") },
    ]);
    expect(r.laneCount).toBe(1);
    expect(r.lanes).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("stacks overlapping eras onto separate lanes", () => {
    const r = packLanes([
      { id: "a", startMs: ms("2000-01-01"), endMs: ms("2005-01-01") },
      { id: "b", startMs: ms("2001-01-01"), endMs: ms("2003-01-01") },
      { id: "c", startMs: ms("2002-01-01"), endMs: ms("2004-01-01") },
    ]);
    expect(r.laneCount).toBe(3);
    expect(r.lanes.a).toBe(0);
    expect(r.lanes.b).toBe(1);
    expect(r.lanes.c).toBe(2);
  });

  it("reuses a freed lane after an era ends", () => {
    const r = packLanes([
      { id: "long", startMs: ms("2000-01-01"), endMs: ms("2010-01-01") },
      { id: "early", startMs: ms("2000-01-01"), endMs: ms("2002-01-01") },
      { id: "late", startMs: ms("2003-01-01"), endMs: ms("2004-01-01") },
    ]);
    // Equal starts tiebreak by earlier end: early -> lane 0, long -> lane 1.
    // late (2003) reuses lane 0 since early ended in 2002.
    expect(r.laneCount).toBe(2);
    expect(r.lanes.early).toBe(0);
    expect(r.lanes.long).toBe(1);
    expect(r.lanes.late).toBe(0);
  });

  it("treats touching intervals (end == start) as non-overlapping", () => {
    const r = packLanes([
      { id: "a", startMs: ms("2000-01-01"), endMs: ms("2001-01-01") },
      { id: "b", startMs: ms("2001-01-01"), endMs: ms("2002-01-01") },
    ]);
    expect(r.laneCount).toBe(1);
  });

  it("honors a manual lane hint when the slot is free", () => {
    const r = packLanes([
      { id: "a", startMs: ms("2000-01-01"), endMs: ms("2001-01-01") },
      // b would auto-pack to lane 0 (no overlap with a), but is pinned to lane 1.
      { id: "b", startMs: ms("2002-01-01"), endMs: ms("2003-01-01"), lane: 1 },
      { id: "c", startMs: ms("2004-01-01"), endMs: ms("2005-01-01") },
    ]);
    expect(r.lanes.b).toBe(1); // honored despite no overlap
    expect(r.lanes.a).toBe(0);
    expect(r.lanes.c).toBe(0); // auto-packs into the free lane 0
  });

  it("falls back to auto when a hinted lane conflicts", () => {
    const r = packLanes([
      { id: "a", startMs: ms("2000-01-01"), endMs: ms("2005-01-01"), lane: 0 },
      // wants lane 0 too but overlaps a → auto-packs to lane 1.
      { id: "b", startMs: ms("2001-01-01"), endMs: ms("2003-01-01"), lane: 0 },
    ]);
    expect(r.lanes.a).toBe(0);
    expect(r.lanes.b).toBe(1);
  });

  it("is stable regardless of input order", () => {
    const items = [
      { id: "c", startMs: ms("2002-01-01"), endMs: ms("2004-01-01") },
      { id: "a", startMs: ms("2000-01-01"), endMs: ms("2005-01-01") },
      { id: "b", startMs: ms("2001-01-01"), endMs: ms("2003-01-01") },
    ];
    const r1 = packLanes(items);
    const r2 = packLanes([...items].reverse());
    expect(r1.lanes).toEqual(r2.lanes);
  });
});
