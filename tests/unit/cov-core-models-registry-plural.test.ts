import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registryFile } from "../../src/core/lib/models-catalog.ts";
import { readRegistry } from "../../src/core/lib/models-registry.ts";

afterEach(() => vi.restoreAllMocks());

describe("readRegistry", () => {
  it("counts several dropped Ollama installations in the plural", () => {
    mkdirSync(join(registryFile(), ".."), { recursive: true });
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeFileSync(
      registryFile(),
      JSON.stringify({
        installs: [
          { model: "a", via: "ollama" },
          { model: "c", via: "ollama" },
        ],
      }),
    );
    expect(readRegistry().installs).toEqual([]);
    expect(String(err.mock.calls[0][0])).toContain("lists 2 installations through Ollama");
  });
});
