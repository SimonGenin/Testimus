import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadCorpus, mechanicalFindings } from "../../../../src/core/lib/check.ts";
import { convertText, decodeText } from "../../../../src/core/rag/convert-text.ts";
import type { DocJson, Test } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

let P = "";
const client = (name: string, data: string | Buffer) => {
  const f = join(mkdtempSync(join(tmpdir(), "testimus-client-")), name);
  writeFileSync(f, data);
  return f;
};
const md = (id: string) => readFileSync(join(P, "docs", id, "doc.md"), "utf8");

beforeEach(() => {
  P = fixtureCopy("text");
});

describe("a text file", () => {
  it("is decoded as UTF-8, else Windows-1252", () => {
    expect(decodeText(new TextEncoder().encode("﻿Été"))).toBe("Été");
    expect(decodeText(Uint8Array.from([0xc9, 0x74, 0xe9, 0x20, 0x9c]))).toBe("Été œ");
  });

  it("is one section under its title; a line starting with # never reads as a heading", () => {
    const c = convertText(new TextEncoder().encode("Ligne 1\n# pas un titre\r\n\r\n\r\nFin <!-- x -->"), {
      markdown: false,
      title: "Notes de réunion",
    });
    expect(c.md).toBe(
      "# Notes de réunion <!-- § notes-de-reunion -->\n\nLigne 1\n\\# pas un titre\n\nFin <! -- x -->\n",
    );
    expect(c.convertedWith).toBe("text 1");
  });

  it("in Markdown keeps its headings, anchored by number or slug", () => {
    const c = convertText(
      new TextEncoder().encode("# Guide\n\nIntro.\n\n## 2.1 Ouvrir\n\nTexte.\n\n## Fermer\n\nFin."),
      {
        markdown: true,
        title: "x",
      },
    );
    expect(c.md.split("\n").filter((l) => l.startsWith("#"))).toEqual([
      "# Guide <!-- § guide -->",
      "## 2.1 Ouvrir <!-- § 2.1 -->",
      "## Fermer <!-- § fermer -->",
    ]);
  });

  it("is added, converted, indexed and cited like a Word document", async () => {
    const d = await call<DocJson>(
      "docs.add",
      {
        file: client("Compte rendu réunion.txt", "Le régulateur acquitte l'alarme de refus de manœuvre.\n"),
        index: false,
      },
      P,
    );
    expect(d).toMatchObject({ id: "Compte_rendu_reunion", title: "Compte rendu réunion" });
    expect(d.source.file).toBe("source.txt");
    expect(md(d.id)).toContain("<!-- § compte-rendu-reunion -->");
    const test = {
      summary: "s",
      description: "d",
      steps: [
        {
          fields: { Action: "a", "Expected Result": "b" },
          sources: [
            {
              docId: d.id,
              anchor: "§compte-rendu-reunion",
              quote: "Le régulateur acquitte l'alarme de refus de manœuvre",
            },
          ],
          images: [],
        },
      ],
    } as unknown as Test;
    expect(mechanicalFindings(test, loadCorpus(P))).toEqual([]);
  });
});
