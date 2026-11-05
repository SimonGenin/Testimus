// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { parseAnswer } from "../../../../src/ui/components/claude/AnswerText.tsx";
import { DocText } from "../../../../src/ui/components/sources/DocText.tsx";

afterEach(() => {
  cleanup();
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
    const { container } = render(
      <DocText docId="D" md={"Selon le type de\n sectionneur, le menu diffère."} focus="type de sectionneur" />,
    );
    expect(container.querySelector("[data-focus]")?.textContent).toBe("type de\n sectionneur");
    expect(container.textContent).toBe("Selon le type de\n sectionneur, le menu diffère.");
  });
});
