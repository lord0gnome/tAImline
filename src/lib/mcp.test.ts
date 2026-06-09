import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// DB-backed test for the MCP update tools' partial-edit semantics. Set the DB
// path before any dynamic import pulls in the (path-reading) client.
const DB = `./data/test-mcp-${Date.now()}.db`;
process.env.DATABASE_PATH = DB;

let U: string;
let mcp: typeof import("./mcp.ts");
let user: (typeof import("../db/schema.ts").users)["$inferSelect"];

const call = (name: string, args: Record<string, unknown>) =>
  mcp.callTool(user, name, args).then((r) => {
    if (r.isError) throw new Error(r.text);
    return JSON.parse(r.text);
  });

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("./../db/client.ts");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  const schema = await import("./../db/schema.ts");
  U = randomUUID();
  db.insert(schema.users)
    .values({ id: U, handle: "carol", displayName: "Carol", defaultVisibility: "private", email: "c@x.com" })
    .run();
  user = db.select().from(schema.users).where(eq(schema.users.id, U)).get()!;
  mcp = await import("./mcp.ts");
});

afterAll(() => {
  for (const s of ["", "-shm", "-wal"]) try { rmSync(DB + s); } catch {}
});

describe("update_era (partial edit)", () => {
  it("changes only the provided field and preserves the rest", async () => {
    const { era } = await call("create_era", {
      title: "University", startDate: "2008-09-01", startPrecision: "month",
      endDate: "2012-06-01", endPrecision: "month", color: "#4a6fa5",
      categories: ["Education"], descriptionMd: "studied things",
    });

    const { era: updated } = await call("update_era", { id: era.id, color: "#c0563a" });

    expect(updated.color).toBe("#c0563a");      // changed
    expect(updated.title).toBe("University");    // preserved
    expect(updated.endDate).toBe("2012-06-01");  // preserved
    expect(updated.categories).toEqual(["Education"]); // preserved
    expect(updated.descriptionMd).toBe("studied things"); // preserved
  });

  it("clears the end date when endDate: null is passed explicitly", async () => {
    const { era } = await call("create_era", {
      title: "Job", startDate: "2012-07-01", endDate: "2015-01-01", endPrecision: "month",
    });
    const { era: updated } = await call("update_era", { id: era.id, endDate: null });
    expect(updated.endDate).toBeNull();
    expect(updated.title).toBe("Job"); // still here
  });
});

describe("update_post (partial edit)", () => {
  it("edits the body without losing the era attachment or date", async () => {
    const { era } = await call("create_era", { title: "Travels", startDate: "2016-01-01" });
    const { post } = await call("create_post", {
      title: "Japan trip", eventDate: "2016-04-10", eraId: era.id, bodyMd: "first draft",
    });

    const { post: updated } = await call("update_post", { id: post.id, bodyMd: "final draft" });

    expect(updated.bodyMd).toBe("final draft"); // changed
    expect(updated.eraId).toBe(era.id);          // preserved
    expect(updated.eventDate).toBe("2016-04-10"); // preserved
  });
});
