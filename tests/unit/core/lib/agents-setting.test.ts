import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { agentPool, agentsSetting } from "../../../../src/core/lib/agents.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";

afterEach(() => rmSync(join(env.dataDir(), "settings.json"), { force: true }));

describe("an agents.max settings.json cannot read as a number", () => {
  it("falls back to the default, and the pool still runs work", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, agents: { max: "auto" as unknown as number, adaptive: false } });
    expect(agentsSetting().max).toBe(5);
    const pool = agentPool();
    expect(pool.limit()).toBe(5);
    const ran = await Promise.race([pool.run(async () => "ran"), new Promise((r) => setTimeout(() => r("stuck"), 50))]);
    expect(ran).toBe("ran");
  });
});
