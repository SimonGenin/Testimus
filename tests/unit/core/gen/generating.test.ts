import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeOut, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { projectOverview } from "../../../../src/core/lib/project-info.ts";
import { holdNewTests, listLocalTests, writeTest } from "../../../../src/core/lib/store.ts";
import { parseTest } from "../../../../src/core/lib/testfile.ts";
import { testsCorpus } from "../../../../src/core/search/tests.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const real = env.spawnClaude;
let dir: string;

const line = (m: unknown) => JSON.stringify(m);

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-generating-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

const ids = (refs: { id: string }[]) => refs.map((r) => r.id);
const local = () => parseTest(readFileSync(join(dir, "tests", "local-3f9a12c0", "test.md"), "utf8")).test;

describe("a running generation holds its tests", () => {
  it("hides a local test written after it started, except from tests.list generating and one made here", () => {
    const release = holdNewTests(dir);
    writeTest(dir, "local-0000beef", { ...local(), summary: "En cours" });
    writeTest(dir, "LFRPS12-9999", { ...local(), key: "LFRPS12-9999", summary: "Tiré de Jira" });
    expect(ids(listLocalTests(dir))).toEqual(["LFRPS12-1398", "LFRPS12-1420", "LFRPS12-9999", "local-3f9a12c0"]);
    const all = listLocalTests(dir, { generating: true });
    expect(all.find((t) => t.id === "local-0000beef")?.generating).toBe(true);
    expect(all.find((t) => t.id === "local-3f9a12c0")?.generating).toBeUndefined();
    expect(testsCorpus(dir).docs.map((d) => d.id)).not.toContain("local-0000beef");
    expect(projectOverview(dir).counts.tests).toBe(4);
    release();
    expect(ids(listLocalTests(dir))).toContain("local-0000beef");
    expect(listLocalTests(dir).find((t) => t.id === "local-0000beef")?.generating).toBeUndefined();
    expect(testsCorpus(dir).docs.map((d) => d.id)).toContain("local-0000beef");
    expect(projectOverview(dir).counts.tests).toBe(5);
  });

  it("gen.tests: Claude's test is nowhere but in Generate's list until the generation ends", async () => {
    const at: Record<string, unknown> = {};
    env.spawnClaude = async (s): Promise<ClaudeOut> => {
      mkdirSync(join(s.cwd, "tests", "local-0000beef"), { recursive: true });
      const md = readFileSync(join(s.cwd, "tests", "local-3f9a12c0", "test.md"), "utf8");
      writeFileSync(
        join(s.cwd, "tests", "local-0000beef", "test.md"),
        md.replace(/^summary: .*$/m, "summary: En cours").replace(/^generated_by: .*\n/m, ""),
      );
      const hand = (await invoke("tests.create", { summary: "À la main" }, { project: dir })) as { id: string };
      at.hand = hand.id;
      at.list = ids((await invoke("tests.list", {}, { project: dir })) as { id: string }[]);
      at.generate = (await invoke("tests.list", { generating: true }, { project: dir })) as {
        id: string;
        generating?: boolean;
      }[];
      at.queue = JSON.stringify(await invoke("review.queue", {}, { project: dir }));
      const reply = 'Écrit.\n```gen-report\n{"tests": ["local-0000beef"], "skipped": []}\n```';
      const ls = [
        line({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t",
                name: "Write",
                input: { file_path: join(dir, "tests", "local-0000beef", "test.md"), content: "…" },
              },
            ],
          },
        }),
        line({ type: "result", subtype: "success", is_error: false, result: reply, session_id: "s", duration_ms: 9 }),
      ];
      for (const l of ls) s.onLine?.(l);
      return { code: 0, stdout: `${ls.join("\n")}\n`, stderr: "" };
    };
    const r = (await invoke("gen.tests", { request: "x", check: false }, { project: dir })) as { tests: string[] };
    expect(r.tests).toEqual(["local-0000beef"]);
    expect(at.list).not.toContain("local-0000beef");
    expect(at.list).toContain(at.hand);
    expect(at.queue).not.toContain("local-0000beef");
    const generate = at.generate as { id: string; generating?: boolean }[];
    expect(generate.find((t) => t.id === "local-0000beef")?.generating).toBe(true);
    expect(generate.find((t) => t.id === at.hand)?.generating).toBeUndefined();
    expect(ids((await invoke("tests.list", {}, { project: dir })) as { id: string }[])).toContain("local-0000beef");
    expect(JSON.stringify(await invoke("review.queue", {}, { project: dir }))).toContain("local-0000beef");
  });
});
