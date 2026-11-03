import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../../scripts/screens-catalog.ts";
import { MOCK_MACHINES } from "../../../src/core/mock/machine.ts";
import { MOCK_ADVICE } from "../../../src/core/mock/models.ts";

const ESSAI = "/tmp/essai-project";
const SCREENS = ["documents", "generate", "tests", "review", "jobs", "settings", "doctor", "setup", "kit"];
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
  TESTIMUS_MOCK_JIRA_MS: (v) => Number(v) > 0,
  TESTIMUS_MOCK_DOWNLOAD_MS: (v) => Number(v) >= 0,
  TESTIMUS_MOCK_MAX_ATTACHMENT: (v) => Number(v) > 0,
};

describe("npm run screens: the catalog (GOAL-V3 proof 5, audit M-X1)", () => {
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

  it("starts each scenario's server with mock settings the sandbox knows", () => {
    for (const s of scenarios)
      for (const [k, v] of Object.entries(s.env)) {
        expect(Object.keys(MOCK_VALUES), `${s.id} ${k}`).toContain(k);
        expect(MOCK_VALUES[k](v), `${s.id} ${k}=${v}`).toBe(true);
      }
    expect(scenarios.find((s) => s.id === "essai")?.env.TESTIMUS_MOCK_SEED).toBe(`${ESSAI},fixture`);
  });
});
