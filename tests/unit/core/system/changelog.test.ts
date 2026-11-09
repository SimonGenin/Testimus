import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addUnreleased,
  itemsOf,
  notesOf,
  parseChangelog,
  readChangelog,
  releaseChangelog,
} from "../../../../src/core/lib/changelog.ts";
import { compareVersions } from "../../../../src/core/lib/updates.ts";
import { call } from "../registry.ts";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../../../package.json"), "utf8")) as {
  version: string;
};

const LOG = `# Changelog

Intro text, not a version.

## 0.0.2 — 2026-11-05

- Two
  wrapped.

## Unreleased

- New thing.

## 0.0.10 — 2026-11-09

* Ten.

## Notes

- not a version
`;

describe("CHANGELOG.md", () => {
  it("reads Unreleased first, then the versions newest first, with wrapped lines joined", () => {
    expect(parseChangelog(`﻿${LOG}`)).toEqual([
      { version: "Unreleased", date: "", items: ["New thing."] },
      { version: "0.0.10", date: "2026-11-09", items: ["Ten."] },
      { version: "0.0.2", date: "2026-11-05", items: ["Two wrapped."] },
    ]);
  });

  it("publishing renames Unreleased to the version and opens an empty one above", () => {
    const next = releaseChangelog(LOG, "0.0.11", "2026-11-10");
    expect(parseChangelog(next).slice(0, 2)).toEqual([
      { version: "Unreleased", date: "", items: [] },
      { version: "0.0.11", date: "2026-11-10", items: ["New thing."] },
    ]);
    expect(() => releaseChangelog(LOG, "0.0.10", "2026-11-10")).toThrow("already has a section 0.0.10");
    expect(() => releaseChangelog(next, "0.0.12", "2026-11-10")).toThrow("nothing under « ## Unreleased »");
  });

  it("--notes adds one line at the end of Unreleased, even an empty one", () => {
    expect(parseChangelog(addUnreleased(LOG, " Extra. "))[0]?.items).toEqual(["New thing.", "Extra."]);
    const empty = releaseChangelog(LOG, "0.0.11", "2026-11-10");
    expect(parseChangelog(addUnreleased(empty, "Only."))[0]?.items).toEqual(["Only."]);
    expect(addUnreleased(LOG, "  ")).toBe(LOG);
    expect(parseChangelog(addUnreleased("## Unreleased\n", "Last."))[0]?.items).toEqual(["Last."]);
    expect(() => addUnreleased("## 0.0.1\n", "x")).toThrow("no « ## Unreleased »");
  });

  it("a release's notes are its lines; older notes are one paragraph", () => {
    expect(notesOf(["A", "B"])).toBe("- A\n- B");
    expect(itemsOf("- A\n- B")).toEqual(["A", "B"]);
    expect(itemsOf("Première version\nsur deux lignes")).toEqual(["Première version sur deux lignes"]);
    expect(itemsOf("  ")).toEqual([]);
  });

  it("the repository's changelog has the running version, and the command lists it newest first", async () => {
    const entries = readChangelog();
    expect(entries.some((e) => e.version === pkg.version && e.items.length > 0)).toBe(true);
    const out = await call<{ current: string; entries: { version: string; items: string[] }[] }>(
      "system.changelog",
      {},
      null,
    );
    expect(out.current).toBe(pkg.version);
    expect(out.entries.every((e) => e.items.length || e.version !== "Unreleased")).toBe(true);
    const versions = out.entries.map((e) => e.version).filter((v) => v !== "Unreleased");
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)));
  });
});
