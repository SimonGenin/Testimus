import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PICTURE_MARKER, PICTURES_TAG } from "../../../../src/core/claude/picture.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
const ID = "LFRPS12-1420";
const FIG = "SOSIE_211_D401-1_3#fig:40";
let P = "";
let seen: ClaudeSpawn[] = [];

type Found = {
  ok: boolean;
  summary: string;
  pictures: { figure: string; file: string; field: string; why: string }[];
};

const answer = (replies: string[]) => {
  env.spawnClaude = async (s) => {
    seen.push(s);
    const text = replies[Math.min(seen.length - 1, replies.length - 1)];
    const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "s" });
    s.onLine?.(l);
    return { code: 0, stdout: `${l}\n`, stderr: "" };
  };
};
const block = (pictures: unknown) => `Vu.\n\`\`\`${PICTURES_TAG}\n${JSON.stringify({ pictures })}\n\`\`\``;
const why = "Le symbole du sectionneur sur la schématique.";

beforeEach(() => {
  P = fixtureCopy("find-image");
  seen = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("tests.findImage proposes pictures of a step's screen and adds none (H)", () => {
  it("against the --mock Claude: the sectionneur's figure, with its file and what it shows", async () => {
    env.spawnClaude = mockSpawnClaude;
    const before = readTest(P, ID).md;
    const r = await call<Found>("tests.findImage", { id: ID, step: 1 }, P);
    expect(r.ok).toBe(true);
    expect(r.pictures).toHaveLength(1);
    expect(r.pictures[0]).toMatchObject({ figure: FIG, field: "Action" });
    expect(existsSync(join(P, r.pictures[0].file))).toBe(true);
    expect(readTest(P, ID).md).toBe(before);
  });

  it("a short Sonnet run told the step and the order to look in; a picture without a file is left out", async () => {
    answer([
      block([
        { figure: FIG, field: "Expected Result", why },
        { figure: "SOSIE_211_D401-1_3#fig:999", why },
        { figure: FIG, why },
      ]),
    ]);
    const r = await call<Found>("tests.findImage", { id: ID, step: 1 }, P);
    expect(r.pictures).toEqual([
      { figure: FIG, file: "docs/SOSIE_211_D401-1_3/figures/fig-40.png", field: "Expected Result", why },
    ]);
    const s = seen[0];
    expect(s.stdin.startsWith(`${PICTURE_MARKER} for step 1 of the test ${ID}`)).toBe(true);
    expect(s.stdin).toContain(`Action: ${readTest(P, ID).test.steps[0].fields.Action}`);
    expect(s.stdin).toMatch(
      /a figure of the documents .* then a photo of the interface .* then a key frame of a video/,
    );
    expect(s.args[s.args.indexOf("--model") + 1]).toBe("sonnet");
    expect(s.args[s.args.indexOf("--effort") + 1]).toBe("low");
    const allowed = s.args[s.args.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).toContain("mcp__testimus__media_keep");
    expect(allowed).toContain("mcp__testimus__rag_figure");
    expect(allowed).not.toContain("mcp__testimus__tests_addImage");
    expect(allowed).not.toContain("Write");
  });

  it("none found is an answer; an unreadable one is asked again once", async () => {
    answer(["Rien.", block([])]);
    const r = await call<Found>("tests.findImage", { id: ID, step: 2 }, P);
    expect(seen).toHaveLength(2);
    expect(seen[1].args).toContain("--resume");
    expect(r).toMatchObject({ ok: true, pictures: [] });
    await expect(call("tests.findImage", { id: ID, step: 99 }, P)).rejects.toThrow(/Step 99 does not exist/);
  });
});
