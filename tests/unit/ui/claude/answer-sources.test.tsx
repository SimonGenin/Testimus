// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { parseAnswer } from "../../../../src/ui/components/claude/AnswerText.tsx";
import { highlight } from "../../../../src/ui/components/sources/PassageDialog.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  setProject(null);
});

describe("source references in Claude's text", () => {
  it('turns docId#anchor "quote" into sources', () => {
    const parts = parseAnswer('Seulement Propriétés SOSIE_211_D401-1_3#§5.6.6 "ne propose que Propriétés". Fin.');
    expect(parts).toEqual([
      "Seulement Propriétés ",
      { docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "ne propose que Propriétés" },
      ". Fin.",
    ]);
  });

  it("highlights a quote whatever its whitespace", () => {
    const out = highlight("Selon le type de\n sectionneur, le menu diffère.", "type de sectionneur");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Selon le ");
    expect(out[2]).toBe(", le menu diffère.");
  });
});
