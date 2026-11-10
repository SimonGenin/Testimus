import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { quietCtx } from "../command.ts";
import { agentProbe } from "../commands/system.ts";
import { env } from "../env.ts";
import { DEFAULT_PROJECT, writeJson, writeProject } from "../lib/project.ts";
import { templateDir } from "../lib/shipped.ts";
import { mockPace } from "../rag/runtimes/mock.ts";
import { mockProbeDeps } from "./agents.ts";
import { mockSpawnClaude } from "./claude.ts";
import "./claude-actions.ts";
import "./claude-analyze.ts";
import "./claude-check.ts";
import "./claude-columns.ts";
import "./claude-gen.ts";
import "./claude-media.ts";
import "./claude-overview.ts";
import "./claude-study.ts";
import { mockHttp } from "./jira.ts";
import { mockModelsOptions, seedChoice, setupModelsMock } from "./models.ts";
import { setupUpdatesMock } from "./updates.ts";
import { setupVideoMock } from "./video.ts";

export function fixturesDir(): string {
  return fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));
}

// ponytail: a mock sandbox outlives its server (a test reads its job logs after the quit); the ones older than a day
// are removed at the next start, so they never pile up in %TEMP%
function dropOldSandboxes(): void {
  const day = Date.now() - 24 * 3600 * 1000;
  for (const name of readdirSync(tmpdir()))
    if (name.startsWith("testimus-mock-"))
      try {
        const dir = join(tmpdir(), name);
        if (statSync(dir).mtimeMs < day) rmSync(dir, { recursive: true, force: true });
      } catch {}
}

// ponytail: TESTIMUS_MOCK_SEED picks the sandbox's projects, comma-separated, the first one open: `fixture` (default,
// the LFRPS12 sample), `empty` (a project with no document and no test, no Jira key), `none` (no project at all: the
// first run), or a project folder of this PC, copied (never touched)
function seedProjects(root: string, spec: string): string[] {
  const dirs: string[] = [];
  for (const s of spec.split(",").map((x) => x.trim())) {
    if (!s || s === "none") continue;
    if (s === "fixture") {
      const project = join(root, "LFRPS12");
      const seed = join(fixturesDir(), "project");
      if (existsSync(join(seed, "project.json"))) cpSync(seed, project, { recursive: true });
      else {
        mkdirSync(project, { recursive: true });
        writeProject(project, { ...DEFAULT_PROJECT, name: "RATP Sosie", jiraProject: "LFRPS12" });
      }
      // ponytail: as project init leaves it — the shipped skills and CLAUDE.md beside the team's own skill
      cpSync(join(templateDir(), ".claude"), join(project, ".claude"), { recursive: true });
      cpSync(join(templateDir(), "CLAUDE.md"), join(project, "CLAUDE.md"));
      dirs.push(project);
    } else if (s === "empty") {
      const project = join(root, "Empty");
      mkdirSync(project, { recursive: true });
      writeProject(project, { ...DEFAULT_PROJECT, name: "Empty" });
      dirs.push(project);
    } else {
      if (!existsSync(join(s, "project.json"))) throw new Error(`TESTIMUS_MOCK_SEED: ${s} is not a Testimus project`);
      const project = join(root, basename(s));
      cpSync(s, project, { recursive: true });
      dirs.push(project);
    }
  }
  return dirs;
}

export async function setupMock(): Promise<string | null> {
  dropOldSandboxes();
  const root = mkdtempSync(join(tmpdir(), "testimus-mock-"));
  const home = join(root, "home");
  const data = join(root, "appdata");
  const local = join(root, "localappdata");
  mkdirSync(join(home, ".atlassian"), { recursive: true });
  writeJson(join(home, ".atlassian", "credentials.json"), {
    baseUrl: "https://mock.atlassian.net/wiki",
    email: "tester@example.com",
    token: "mock-token",
  });
  writeJson(join(home, ".atlassian", "xray_credentials.json"), { clientId: "mock-id", clientSecret: "mock-secret" });
  const projects = seedProjects(root, process.env.TESTIMUS_MOCK_SEED || "fixture");
  const project = projects[0] ?? null;
  writeFileSync(join(root, "README.txt"), "Testimus --mock sandbox: deleted with the temp folder.\n");
  env.mock = true;
  env.homeDir = () => home;
  env.dataDir = () => data;
  env.localDir = () => local;
  env.http = mockHttp;
  env.spawnClaude = mockSpawnClaude;
  agentProbe.deps = () => mockProbeDeps();
  setupUpdatesMock(root);
  writeJson(join(data, "settings.json"), { projects, lastProject: project, models: { allowRemote: false } });
  const models = mockModelsOptions();
  await setupModelsMock(root, project, models);
  setupVideoMock(root);
  const { indexProject } = await import("../rag/indexer.ts");
  for (const p of projects) {
    if (p !== project) seedChoice(p, models.advice);
    await indexProject(p, quietCtx(p), models.index === "bm25" ? { model: null } : {}).catch(() => {});
  }
  mockPace.embedMs = Math.max(0, Number(process.env.TESTIMUS_MOCK_INDEX_MS) || 0);
  const slow = readPace(process.env.TESTIMUS_MOCK_READ_MS ?? "");
  env.readMs = (name) => slow.get(name) ?? 0;
  return project;
}

// ponytail: TESTIMUS_MOCK_READ_MS="tests.list=12000,docs.show=3000" — those reads answer that late, every time (the
// page's loading line, its « answering slowly » and Try again)
export function readPace(spec: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of spec.split(",")) {
    const [name, ms] = part.split("=").map((x) => x.trim());
    if (name && Number(ms) > 0) out.set(name, Number(ms));
  }
  return out;
}
