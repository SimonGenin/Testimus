import { describe, expect, it } from "vitest";
import { approxTokens, chunkDoc, MAX_TOKENS } from "../../src/core/rag/chunk.ts";
import type { DocJson } from "../../src/core/types.ts";

const doc = { id: "D", code: "D", title: "Doc" } as DocJson;

describe("chunking a huge table", () => {
  it("cuts it by rows under the budget and repeats the header", () => {
    const rows = Array.from(
      { length: 600 },
      (_, i) => `| EXI_MOP_SPF_600_A_${i} | Le système affiche la ligne ${i} du tableau. |`,
    );
    const md = `# D — Doc\n\n### 6.1 Exigences <!-- § 6.1 -->\n\n| Id | Texte |\n|---|---|\n${rows.join("\n")}\n`;
    const chunks = chunkDoc(doc, md, []).filter((c) => c.kind === "section");
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(approxTokens(c.text)).toBeLessThanOrEqual(MAX_TOKENS + 60);
      expect(c.text).toContain("| Id | Texte |");
    }
    expect(chunks.map((c) => c.text).join("\n")).toContain("EXI_MOP_SPF_600_A_599");
  });
});
