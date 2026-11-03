import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { checkedExe } from "../../../../src/core/commands/system.ts";
import { env } from "../../../../src/core/env.ts";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import { readSettings } from "../../../../src/core/lib/project.ts";

const atl = () => join(env.homeDir(), ".atlassian");
const saved = { http: env.http };

beforeEach(() => {
  rmSync(atl(), { recursive: true, force: true });
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
  env.http = async (req) => {
    if (req.url.endsWith("/rest/api/3/myself")) return { status: 200, headers: {}, text: "{}" };
    if (req.url.endsWith("/api/v2/authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
    throw new Error(`unexpected ${req.url}`);
  };
});
afterEach(() => {
  env.http = saved.http;
  vi.unstubAllEnvs();
});

describe("system.credentials and system.setCredentials — less common inputs", () => {
  it("takes the token and the secret from the environment, and another https host when confirmed", async () => {
    vi.stubEnv("TESTIMUS_JIRA_TOKEN", "env-token");
    vi.stubEnv("TESTIMUS_XRAY_SECRET", "env-secret");
    const r = (await invoke(
      "system.setCredentials",
      {
        site: "https://jira.acme.example",
        email: "a@b.c",
        clientId: "id",
        apiBase: "https://xray.acme.example/",
        otherHost: true,
      },
      { project: null },
    )) as { saved: string[]; ok: boolean };
    expect(r.saved).toEqual(
      expect.arrayContaining(["baseUrl", "email", "token", "clientId", "clientSecret", "apiBase"]),
    );
    const jira = JSON.parse(readFileSync(join(atl(), "credentials.json"), "utf8"));
    expect(jira.token).toBe("env-token");
    const xray = JSON.parse(readFileSync(join(atl(), "xray_credentials.json"), "utf8"));
    expect(xray).toMatchObject({ clientSecret: "env-secret", apiBase: "https://xray.acme.example" });
  });

  it("a check with no credentials at all runs no check", async () => {
    const r = (await invoke("system.credentials", { check: true }, { project: null })) as {
      checks: unknown[];
      ok: boolean;
    };
    expect(r).toMatchObject({ checks: [], ok: false });
  });

  it("refuses an Xray address that is not Xray Cloud unless confirmed", async () => {
    await expect(
      invoke("system.setCredentials", { apiBase: "https://collector.evil.example" }, { project: null }),
    ).rejects.toThrow(/not an Xray Cloud address/);
  });
});

describe("models.pull and system.set", () => {
  it("refuses an unknown model", async () => {
    await expect(invoke("models.pull", { model: "nope" }, { project: null, wait: true })).rejects.toThrow(
      /Unknown model nope/,
    );
  });

  it("a model already on this PC is answered without any download", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-cov-cmds-m-"));
    const file = join(dir, "m.gguf");
    writeFileSync(file, "");
    writeRegistry({
      ...readRegistry(),
      installs: [
        { model: "qwen3-embedding-0.6b-q8", via: "path", runtime: "llamacpp", path: file, status: "verified" },
      ],
    });
    try {
      const r = await invoke("models.pull", { model: "qwen3-embedding-0.6b-q8" }, { project: null, wait: true });
      expect(r).toMatchObject({ model: "qwen3-embedding-0.6b-q8", where: file, via: "path" });
    } finally {
      rmSync(registryFile(), { force: true });
    }
  });

  it("an empty claude.exe means PATH, and downloads can be turned back on", async () => {
    expect(checkedExe("   ")).toBe("");
    await invoke("system.set", { claudeExe: "", allowRemote: true }, { project: null });
    expect(readSettings()).toMatchObject({ claude: { exe: "" }, models: { allowRemote: true } });
  });
});
