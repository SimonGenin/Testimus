import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kitSectionNames, SCENARIOS } from "../../../scripts/screens-catalog.ts";
import { readPace } from "../../../src/core/mock/index.ts";
import { MOCK_MACHINES } from "../../../src/core/mock/machine.ts";
import { MOCK_ADVICE } from "../../../src/core/mock/models.ts";
import type { KitSection } from "../../../src/ui/screens/kit/kit.tsx";

const ESSAI = "/tmp/essai-project";
const SCREENS = ["documents", "generate", "tests", "review", "run", "jobs", "settings", "doctor", "setup", "kit"];
const SIZES = ["lg", "md", "sm", "xs"];
const ID = /^[a-z0-9][a-z0-9-]*$/;

const MOCK_VALUES: Record<string, (v: string) => boolean> = {
  TESTIMUS_MOCK_SEED: (v) => v.split(",").every((s) => ["none", "empty", "fixture", ESSAI].includes(s)),
  TESTIMUS_MOCK_CLAUDE: (v) => ["absent", "logged-out"].includes(v),
  TESTIMUS_MOCK_MACHINE: (v) => (MOCK_MACHINES as readonly string[]).includes(v),
  TESTIMUS_MOCK_ADVICE: (v) => (MOCK_ADVICE as readonly string[]).includes(v),
  TESTIMUS_MOCK_INDEX: (v) => ["vectors", "bm25"].includes(v),
  TESTIMUS_MOCK_MODELS_DIR: (v) => ["set", "unset"].includes(v),
  TESTIMUS_MOCK_LLAMACPP: (v) => ["found", "absent"].includes(v),
  TESTIMUS_MOCK_PROBE: (v) => ["ok", "fail"].includes(v),
  TESTIMUS_MOCK_CLAUDE_MS: (v) => Number(v) > 0,
  TESTIMUS_MOCK_CLAUDE_STEP_MS: (v) => Number(v) > 0,
  TESTIMUS_MOCK_JIRA_MS: (v) => Number(v) > 0,
  TESTIMUS_MOCK_DOWNLOAD_MS: (v) => Number(v) >= 0,
  TESTIMUS_MOCK_INDEX_MS: (v) => Number(v) > 0,
  TESTIMUS_MOCK_MAX_ATTACHMENT: (v) => Number(v) > 0,
  TESTIMUS_MOCK_READ_MS: (v) => readPace(v).size === v.split(",").length,
};

describe("npm run screens: the catalog", () => {
  const scenarios = SCENARIOS(ESSAI);

  it("has scenarios with unique ids, each with a note and at least one shot", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(16);
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of scenarios) {
      expect(s.id, s.id).toMatch(ID);
      expect(s.note.trim(), s.id).not.toBe("");
      expect(s.shots.length, s.id).toBeGreaterThan(0);
    }
    for (const id of ["none", "empty", "fixture", "two-projects", "claude-absent", "essai", "desktop"])
      expect(ids).toContain(id);
  });

  it("lets a shot excuse only the failed request it causes on purpose, with its reason", () => {
    const excused = scenarios.flatMap((s) => s.shots.filter((sh) => sh.expectErrors).map((sh) => `${s.id}/${sh.id}`));
    expect(excused.sort()).toEqual([
      "fixture/error-document",
      "fixture/error-models",
      "fixture/tests-bad-id",
      "fixture/toast-error",
    ]);
    for (const s of scenarios)
      for (const sh of s.shots.filter((x) => x.expectErrors)) {
        const want = sh.expectErrors as { pattern: RegExp; why: string };
        expect(want.why.length, `${s.id}/${sh.id}`).toBeGreaterThan(20);
        expect(want.pattern.test("Failed to load resource: the server responded with a status of 500 (x)")).toBe(
          want.pattern.source.includes("500"),
        );
        expect(want.pattern.test("TypeError: Cannot read properties of undefined"), `${s.id}/${sh.id}`).toBe(false);
      }
  });

  it("gives every shot a unique scenario/shot id, a note and a way to reach it", () => {
    const all = scenarios.flatMap((s) => s.shots.map((shot) => `${s.id}/${shot.id}`));
    expect(new Set(all).size).toBe(all.length);
    for (const s of scenarios)
      for (const shot of s.shots) {
        const where = `${s.id}/${shot.id}`;
        expect(shot.id, where).toMatch(ID);
        expect(shot.note.trim(), where).not.toBe("");
        expect(!!(shot.hash || shot.page || shot.prep), where).toBe(true);
      }
  });

  it("reaches every app shot by the hash of a known screen, in known sizes", () => {
    for (const s of scenarios)
      for (const shot of s.shots) {
        const where = `${s.id}/${shot.id}`;
        if (shot.hash) {
          expect(shot.hash, where).toMatch(/^#\//);
          expect(SCREENS, where).toContain(shot.hash.slice(2).split(/[/?]/)[0]);
        }
        for (const size of shot.sizes ?? []) expect(SIZES, where).toContain(size);
      }
  });

  it("shoots every kit page by the name its section declares (design-gaps point 2: Icon and Banner were empty)", () => {
    const declared = Object.values(
      import.meta.glob<KitSection>("../../../src/ui/screens/kit/sections/*.tsx", { eager: true, import: "section" }),
    )
      .map((s) => s.name)
      .sort();
    expect(kitSectionNames().sort()).toEqual(declared);
    const kit = scenarios.find((s) => s.id === "kit");
    const hashes = (kit?.shots ?? []).map((s) => s.hash);
    for (const name of declared) expect(hashes, name).toContain(`#/kit/${name}`);
    expect(hashes).toContain("#/kit/Icon");
    expect(hashes).toContain("#/kit/Banner");
  });

  it("starts each scenario's server with mock settings the sandbox knows", () => {
    for (const s of scenarios)
      for (const [k, v] of Object.entries(s.env)) {
        expect(Object.keys(MOCK_VALUES), `${s.id} ${k}`).toContain(k);
        expect(MOCK_VALUES[k](v), `${s.id} ${k}=${v}`).toBe(true);
      }
    expect(scenarios.find((s) => s.id === "essai")?.env.TESTIMUS_MOCK_SEED).toBe(`${ESSAI},fixture`);
  });

  it("skips the essai scenario, with where it looked and how to point elsewhere, when that project is not here", () => {
    const missing = join(tmpdir(), "testimus-no-essai-here");
    const away = SCENARIOS(missing).find((s) => s.id === "essai");
    expect(away?.skip).toBe(`no essai project at ${missing} — pass --essai <dir>`);
    const here = mkdtempSync(join(tmpdir(), "testimus-essai-"));
    try {
      expect(SCENARIOS(here).find((s) => s.id === "essai")?.skip).toBeUndefined();
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
    expect(
      SCENARIOS(here)
        .filter((s) => s.skip)
        .map((s) => s.id),
    ).toEqual(["essai"]);
  });
});
