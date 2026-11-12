import { describe, expect, it } from "vitest";
import { find } from "../../../../src/core/commands/index.ts";
import { fieldOrder } from "../../../../src/core/lib/columns.ts";
import { readTest, writeTest } from "../../../../src/core/lib/store.ts";
import { mockAnalysis } from "../../../../src/core/mock/claude-analyze.ts";
import { call, fixtureCopy } from "../registry.ts";

const ID = "LFRPS12-1420";
const SRC = 'SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"';
const NEW = "Vérifie le menu contextuel d'un sectionneur sans TK : ses commandes et la fenêtre Propriétés.";

type Proposal = {
  id: string;
  kind: string;
  field?: string;
  before?: string;
  value?: string;
  state: string;
  now?: number;
  stale?: string;
  undone?: unknown;
};
type Shown = { analysis: { proposals: Proposal[] } | null };

const record = (P: string, proposals: unknown[]) =>
  call("analysis.record", { id: ID, summary: "Le test est relu.", proposals }, P);
const describeIt = (value = NEW, field = "description") => ({
  kind: "describe",
  field,
  title: "Dire ce que les steps vérifient",
  why: "La description promet ce qu'aucun step ne vérifie.",
  value,
  sources: [SRC],
});
const shown = async (P: string) => ((await call<Shown>("analysis.show", { id: ID }, P)).analysis?.proposals ?? [])[0];
const setDescription = (P: string, description: string) =>
  writeTest(P, ID, { ...readTest(P, ID).test, description }, fieldOrder(P));

describe("a describe proposal rewrites the test's summary or description (F)", () => {
  it("is recorded with the text it replaces, accepted into test.md, and open again when undone", async () => {
    const P = fixtureCopy("describe");
    const before = readTest(P, ID).test.description;
    await record(P, [describeIt()]);
    const p = await shown(P);
    expect(p).toMatchObject({ kind: "describe", field: "description", before, value: NEW, state: "open" });
    expect(p.now).toBeUndefined();
    expect(p.stale).toBeUndefined();
    await call("analysis.decide", { id: ID, proposals: [p.id], decision: "accept" }, P);
    expect(readTest(P, ID).test.description).toBe(NEW);
    setDescription(P, before);
    expect(await shown(P)).toMatchObject({ state: "open", undone: {} });
  });

  it("the summary too; a text already there, a second line in a summary or a wrong source is refused", async () => {
    const P = fixtureCopy("describe");
    await record(P, [describeIt("Sectionneur sans TK — menu", "summary")]);
    const p = await shown(P);
    await call("analysis.decide", { id: ID, proposals: [p.id], decision: "accept" }, P);
    expect(readTest(P, ID).test.summary).toBe("Sectionneur sans TK — menu");
    await expect(record(P, [describeIt(readTest(P, ID).test.description)])).rejects.toThrow(
      /the description already says this/,
    );
    await expect(record(P, [describeIt("Une\ndeux", "summary")])).rejects.toThrow(/a summary is one line/);
    await expect(
      record(P, [
        { ...describeIt(), sources: ['SOSIE_211_D401-1_3#§5.6.6 "une phrase que le document ne dit pas du tout"'] },
      ]),
    ).rejects.toThrow(/proposal 1 \(describe\)/);
    expect(
      find("analysis.record").input.safeParse({ id: ID, summary: "s", proposals: [describeIt(NEW, "steps")] }).success,
    ).toBe(false);
  });

  it("a description changed by hand since is out of date and cannot be accepted", async () => {
    const P = fixtureCopy("describe");
    await record(P, [describeIt()]);
    setDescription(P, "Autre chose.");
    const p = await shown(P);
    expect(p.stale).toBe("The description changed since the analysis.");
    await expect(call("analysis.decide", { id: ID, proposals: [p.id], decision: "accept" }, P)).rejects.toThrow(
      /changed since the analysis/,
    );
  });

  it("the mock Claude proposes a description for a test without one, and the record takes it", async () => {
    const P = fixtureCopy("describe");
    setDescription(P, "");
    const a = mockAnalysis(P, readTest(P, ID).test);
    expect(a.proposals.find((x) => x.kind === "describe")).toMatchObject({ field: "description" });
    await call("analysis.record", { id: ID, ...a }, P);
  });

  it("check-test may record a description-mismatch finding", () => {
    const ok = find("check.record").input.safeParse({
      id: ID,
      steps: [],
      findings: [
        { kind: "description-mismatch", severity: "warning", message: "La description promet plus.", sources: [] },
      ],
    });
    expect(ok.success).toBe(true);
  });
});
