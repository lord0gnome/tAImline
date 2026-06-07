import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// DB-backed integration test for the authz/view stack. Set the DB path before
// any dynamic import pulls in the (path-reading) client.
const DB = `./data/test-publicview-${Date.now()}.db`;
process.env.DATABASE_PATH = DB;

let A: string;
let B: string;
// deferred module refs (loaded after DATABASE_PATH is set)
let pv: typeof import("./publicView.ts");
let sh: typeof import("./shares.ts");
let eraIds: Record<string, string> = {};

const owner = () => sh.getUserById(A)!;
const titles = (r: { eras: { title: string }[] }) => r.eras.map((e) => e.title).sort().join(",");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./../db/client.ts");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  const schema = await import("./../db/schema.ts");
  A = randomUUID();
  B = randomUUID();
  db.insert(schema.users).values({ id: A, handle: "alice", displayName: "Alice", defaultVisibility: "private", email: "alice@x.com" }).run();
  db.insert(schema.users).values({ id: B, handle: "bob", displayName: "Bob", defaultVisibility: "private", email: "bob@x.com" }).run();

  const eras = await import("./eras.ts");
  const posts = await import("./posts.ts");
  pv = await import("./publicView.ts");
  sh = await import("./shares.ts");
  const mk = (title: string, visibility: "public" | "private" | "gated") =>
    eras.createEra(A, {
      title, descriptionMd: null, startDate: "2010-01-01", startPrecision: "year",
      endDate: null, endPrecision: null, color: null, category: null, visibility,
    });
  for (const [k, v] of [["pub", "public"], ["priv", "private"], ["gat", "gated"]] as const) {
    const e = mk(`${k} era`, v);
    eraIds[k] = e.id;
    posts.createPost(A, {
      title: `${k} moment`, bodyMd: null, eraId: e.id, eventDate: "2010-06-01",
      eventPrecision: "month", eventEndDate: null, visibility: "inherit",
    });
  }
});

afterAll(() => {
  for (const s of ["", "-shm", "-wal"]) try { rmSync(DB + s); } catch {}
});

describe("viewableTimeline authz", () => {
  it("owner sees everything", () => {
    expect(titles(pv.viewableTimeline(owner(), A))).toBe("gat era,priv era,pub era");
  });
  it("stranger sees only public", () => {
    expect(titles(pv.viewableTimeline(owner(), null))).toBe("pub era");
  });
  it("unrelated user sees only public", () => {
    expect(titles(pv.viewableTimeline(owner(), B))).toBe("pub era");
  });

  it("era-scope grant reveals exactly that gated era (+ its post)", () => {
    const s = sh.createShare(A, { scope: "era", eraId: eraIds.gat, granteeHandle: "bob" });
    expect(s.ok).toBe(true);
    const v = pv.viewableTimeline(owner(), B);
    expect(titles(v)).toBe("gat era,pub era");
    expect(v.posts.map((p) => p.title).sort()).toEqual(["gat moment", "pub moment"]);
    if (s.ok) sh.revokeShare(A, s.id);
    expect(titles(pv.viewableTimeline(owner(), B))).toBe("pub era");
  });

  it("timeline-scope grant reveals gated + public, but NOT private", () => {
    const s = sh.createShare(A, { scope: "timeline", granteeHandle: "bob" });
    // private stays owner-only; grants only unlock the gated tier.
    expect(titles(pv.viewableTimeline(owner(), B))).toBe("gat era,pub era");
    if (s.ok) sh.revokeShare(A, s.id);
  });

  it("viewableEra denies private to others, allows public to anyone", () => {
    expect(pv.viewableEra(owner(), "priv-era", B)).toBeNull();
    expect(pv.viewableEra(owner(), "pub-era", null)).not.toBeNull();
  });

  it("explore lists a user with a public era", () => {
    expect(pv.listPublicProfiles().some((p) => p.handle === "alice")).toBe(true);
  });
});
