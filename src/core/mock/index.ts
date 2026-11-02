import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { quietCtx } from "../command.ts";
import { env } from "../env.ts";
import { DEFAULT_PROJECT, writeJson, writeProject } from "../lib/project.ts";
import { mockSpawnClaude } from "./claude.ts";
import "./claude-check.ts";
import "./claude-gen.ts";
import { mockHttp } from "./jira.ts";
import { mockModelsOptions, setupModelsMock } from "./models.ts";
import { isOllamaUrl, ollamaHttp } from "./ollama.ts";

export function fixturesDir(): string {
  return fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));
}

export async function setupMock(): Promise<string> {
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
  env.http = (req) => (isOllamaUrl(req.url) ? ollamaHttp(req) : mockHttp(req));
  env.spawnClaude = mockSpawnClaude;
  writeJson(join(data, "settings.json"), { projects: [project], lastProject: project, models: { allowRemote: false } });
  const models = mockModelsOptions();
  await setupModelsMock(root, project, models);
  const { indexProject } = await import("../rag/indexer.ts");
  await indexProject(project, quietCtx(project), models.index === "bm25" ? { model: null } : {}).catch(() => {});
  return project;
}
