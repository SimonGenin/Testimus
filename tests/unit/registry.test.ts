import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describe as describeCommand, invoke, registry } from "../../src/core/commands/index.ts";
import { showJob, waitJob } from "../../src/core/jobs.ts";
import { buildServer, toolName } from "../../src/faces/mcp.ts";

describe("registry", () => {
  it("names every command group.verb, once, with a described input", () => {
    const names = registry.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of registry) {
      expect(c.name).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      const schema = describeCommand(c).input as { properties?: Record<string, { description?: string }> };
      for (const [k, v] of Object.entries(schema.properties ?? {}))
        expect(v.description, `${c.name} --${k}`).toBeTruthy();
    }
  });

  it("runs system.version without a project", async () => {
    const v = (await invoke("system.version", {}, { project: null })) as { version: string };
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("refuses a project command without a project", async () => {
    await expect(invoke("jobs.list", {}, { project: null })).rejects.toThrow(/No project/);
  });

  it("lists jobs of a project folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-reg-"));
    expect(await invoke("jobs.list", {}, { project: dir })).toEqual([]);
    expect(showJob(dir, "nope")).toBeNull();
    expect(await waitJob("nope")).toBeUndefined();
  });

  it("derives one MCP tool per command", () => {
    expect(toolName("rag.search")).toBe("rag_search");
    expect(buildServer(null)).toBeTruthy();
  });
});
