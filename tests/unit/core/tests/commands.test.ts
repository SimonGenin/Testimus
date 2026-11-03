import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { call, fixtureCopy } from "../registry.ts";

let P = "";
beforeEach(() => {
  P = fixtureCopy("tests-reg");
});

type Ref = { id: string; summary: string; sync: string; dirty: boolean; review: string };

describe("tests.restore through the registry", () => {
  it("rewrites test.md from .remote.md: the local change and its sync state go", async () => {
    const file = join(P, "tests", "LFRPS12-1398", "test.md");
    const remote = readFileSync(join(P, "tests", "LFRPS12-1398", ".remote.md"), "utf8");
    writeFileSync(file, readFileSync(file, "utf8").replace("Clic droit sur", "Double clic sur"));
    const before = (await call<Ref[]>("tests.list", {}, P)).find((t) => t.id === "LFRPS12-1398");
    expect(before).toMatchObject({ sync: "modified", dirty: true });
    const ref = await call<Ref>("tests.restore", { id: "LFRPS12-1398" }, P);
    expect(ref).toMatchObject({ id: "LFRPS12-1398", sync: "synced", dirty: false, review: "validated" });
    const now = readFileSync(file, "utf8");
    expect(now).toContain("Clic droit sur le disjoncteur D 4");
    expect(now).not.toContain("Double clic");
    expect(now).toBe(remote);
  });

  it("refuses a test never synced with Jira, and an unknown test", async () => {
    await expect(call("tests.restore", { id: "local-3f9a12c0" }, P)).rejects.toThrow(/was never synced with Jira/);
    await expect(call("tests.restore", { id: "LFRPS12-9" }, P)).rejects.toThrow(/LFRPS12-9/);
    await expect(call("tests.restore", { id: "LFRPS12-1398" }, null)).rejects.toThrow(/No project is open/);
  });
});

describe("tests.removeImage through the registry", () => {
  it("deletes a picture no step lists any more", async () => {
    const img = join(P, "tests", "LFRPS12-1420", "images", "img-deadbeef.png");
    writeFileSync(img, "png");
    expect(await call("tests.removeImage", { id: "LFRPS12-1420", file: "images/img-deadbeef.png" }, P)).toEqual({
      removed: true,
    });
    expect(existsSync(img)).toBe(false);
  });

  it("keeps a picture a step still lists under Attachments, and says why", async () => {
    const out = await call("tests.removeImage", { id: "LFRPS12-1420", file: "images/fig-40.png" }, P);
    expect(out).toEqual({ removed: false, reason: "a step still lists it under ### Attachments" });
    expect(existsSync(join(P, "tests", "LFRPS12-1420", "images", "fig-40.png"))).toBe(true);
  });

  it("refuses a path outside the test's images folder", async () => {
    await expect(call("tests.removeImage", { id: "LFRPS12-1420", file: "../LFRPS12-1398/test.md" }, P)).rejects.toThrow(
      /is not a test image/,
    );
    await expect(call("tests.removeImage", { id: "LFRPS12-1420", file: "test.md" }, P)).rejects.toThrow(
      /is not a test image/,
    );
    expect(existsSync(join(P, "tests", "LFRPS12-1420", "test.md"))).toBe(true);
  });
});

describe("tests.list and tests.remove through the registry", () => {
  it("tests.list lists the fixture's three tests with their sync state", async () => {
    const list = await call<Ref[]>("tests.list", {}, P);
    expect(list.map((t) => [t.id, t.sync]).sort()).toEqual([
      ["LFRPS12-1398", "synced"],
      ["LFRPS12-1420", expect.any(String)],
      ["local-3f9a12c0", "local"],
    ]);
  });

  it("tests.remove deletes the test folder", async () => {
    expect(await call("tests.remove", { id: "local-3f9a12c0" }, P)).toEqual({ id: "local-3f9a12c0", removed: true });
    expect(existsSync(join(P, "tests", "local-3f9a12c0"))).toBe(false);
    const list = await call<Ref[]>("tests.list", {}, P);
    expect(list.map((t) => t.id)).not.toContain("local-3f9a12c0");
  });
});
