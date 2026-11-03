import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { readProject } from "../../../../src/core/lib/project.ts";
import { dir } from "../claude/run-fakes.ts";

describe("labelPrefix", () => {
  it("project.set refuses an empty or space-containing labelPrefix", async () => {
    await expect(invoke("project.set", { labelPrefix: "" }, { project: dir })).rejects.toThrow(/Not a label prefix/);
    await expect(invoke("project.set", { labelPrefix: "my team-" }, { project: dir })).rejects.toThrow(
      /Not a label prefix/,
    );
    await invoke("project.set", { labelPrefix: "tm-" }, { project: dir });
    expect(readProject(dir).labelPrefix).toBe("tm-");
  });
});
