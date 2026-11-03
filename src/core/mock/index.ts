import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { quietCtx } from "../command.ts";
import { env } from "../env.ts";
import { DEFAULT_PROJECT, writeJson, writeProject } from "../lib/project.ts";
import { mockSpawnClaude } from "./claude.ts";
import "./claude-actions.ts";
import "./claude-check.ts";
import "./claude-gen.ts";
import { mockHttp } from "./jira.ts";
import { mockModelsOptions, setupModelsMock } from "./models.ts";

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

export async function setupMock(): Promise<string> {
  dropOldSandboxes();
  const root = mkdtempSync(join(tmpdir(), "testimus-mock-"));
  const home = join(root, "home");
  const data = join(root, "appdata");
  const local = join(root, "localappdata");
  const project = join(root, "LFRPS12");
  mkdirSync(join(home, ".atlassian"), { recursive: true });
  writeJson(join(home, ".atlassian", "credentials.json"), {
    baseUrl: "https://mock.atlassian.net/wiki",
    email: "tester@example.com",
    token: "mock-token",
  });
  writeJson(join(home, ".atlassian", "xray_credentials.json"), { clientId: "mock-id", clientSecret: "mock-secret" });
  const seed = join(fixturesDir(), "project");
  if (existsSync(join(seed, "project.json"))) cpSync(seed, project, { recursive: true });
  else {
    mkdirSync(project, { recursive: true });
    writeProject(project, { ...DEFAULT_PROJECT, name: "RATP Sosie", jiraProject: "LFRPS12" });
  }
  writeFileSync(join(root, "README.txt"), "Testimus --mock sandbox: deleted with the temp folder.\n");
  env.mock = true;
  env.homeDir = () => home;
  env.dataDir = () => data;
  env.localDir = () => local;
  env.http = mockHttp;
  env.spawnClaude = mockSpawnClaude;
  writeJson(join(data, "settings.json"), { projects: [project], lastProject: project, models: { allowRemote: false } });
  const models = mockModelsOptions();
  await setupModelsMock(root, project, models);
  const { indexProject } = await import("../rag/indexer.ts");
  await indexProject(project, quietCtx(project), models.index === "bm25" ? { model: null } : {}).catch(() => {});
  return project;
}
