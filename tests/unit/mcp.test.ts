import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { mcpAccess, mcpName, readOnlyCommands } from "../../src/core/claude/run.ts";
import { registry } from "../../src/core/commands/index.ts";
import { toolName } from "../../src/faces/mcp.ts";

const CLI = fileURLToPath(new URL("../../src/faces/cli.ts", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/project/", import.meta.url));

type Msg = { id?: number; result?: Record<string, unknown>; error?: unknown; method?: string };

function client(child: ChildProcessWithoutNullStreams) {
  const waiting = new Map<number, (m: Msg) => void>();
  let buf = "";
  let next = 1;
  child.stdout.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.trim()) continue;
      const m = JSON.parse(l) as Msg;
      if (m.id !== undefined) waiting.get(m.id)?.(m);
    }
  });
  return {
    request(method: string, params: unknown): Promise<Msg> {
      const id = next++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`timeout on ${method}`)), 15000);
        waiting.set(id, (m) => {
          clearTimeout(t);
          res(m);
        });
      });
    },
    notify(method: string, params?: unknown) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
  };
}

describe("MCP face over stdio", () => {
  const root = mkdtempSync(join(tmpdir(), "testimus-mcp-"));
  const project = join(root, "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  const child = spawn(process.execPath, [CLI, "mcp", "--project", project], {
    cwd: root,
    env: { ...process.env, APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "local"), TESTIMUS_HOME: root },
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (d: string) => {
    stderr += d;
  });
  const c = client(child);
  afterAll(() => {
    child.kill();
  });

  it("lists one tool per command and runs one on the project", async () => {
    const init = await c.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1" },
    });
    expect(init.error, stderr).toBeUndefined();
    expect((init.result?.serverInfo as { name: string } | undefined)?.name).toBe("testimus");
    c.notify("notifications/initialized");

    const list = await c.request("tools/list", {});
    const tools = (list.result?.tools ?? []) as { name: string; description: string; inputSchema: unknown }[];
    expect(tools.map((t) => t.name).sort()).toEqual(
      registry
        .filter((r) => r.mcp !== false)
        .map((r) => toolName(r.name))
        .sort(),
    );
    expect(tools.map((t) => t.name)).not.toContain("system_secrets");
    const info = tools.find((t) => t.name === "project_info");
    expect(info?.inputSchema).toBeTruthy();

    const call = await c.request("tools/call", { name: "project_info", arguments: {} });
    const content = (call.result?.content ?? []) as { type: string; text: string }[];
    expect(call.result?.isError, content[0]?.text).toBeFalsy();
    const out = JSON.parse(content[0].text) as { project: { jiraProject: string }; counts: { tests: number } };
    expect(out.project.jiraProject).toBe("LFRPS12");
    expect(out.counts.tests).toBe(3);

    const bad = await c.request("tools/call", { name: "chat_show", arguments: { chatId: "chat-nope" } });
    expect(bad.result?.isError).toBe(true);
    expect((bad.result?.content as { text: string }[] | undefined)?.[0]?.text).toMatch(/No chat chat-nope/);
  }, 30000);

  it("ends when Claude, its parent, closes its stdin (N7)", async () => {
    const gone = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
    child.stdin.end();
    expect(await gone).toBe(0);
  }, 15000);
});

describe("read-only Claude runs and the models commands", () => {
  it("models.verify writes the machine registry: it is not given to a read-only run", async () => {
    expect(registry.find((c) => c.name === "models.verify")?.mutates).toBe(true);
    expect(await readOnlyCommands()).not.toContain("models.verify");
    for (const kind of ["chat", "figures", "headers"] as const) {
      const access = await mcpAccess(kind);
      expect(access.deny).toContain(mcpName("models.verify"));
      expect(access.allow).not.toContain(mcpName("models.verify"));
    }
    expect(await readOnlyCommands()).toEqual(expect.arrayContaining(["models.list", "models.fit", "models.hardware"]));
  });
});
