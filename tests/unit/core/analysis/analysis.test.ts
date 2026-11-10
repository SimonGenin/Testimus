import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { fieldOrder } from "../../../../src/core/lib/columns.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { readTest, writeTest } from "../../../../src/core/lib/store.ts";
import type { Test } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const ID = "LFRPS12-1420";
const D3 = "SOSIE_211_D401-1_3";
const real = env.spawnClaude;
let P = "";

type Proposal = {
  id: string;
  kind: string;
  state: string;
  now?: number;
  stale?: string;
  undone?: { by?: string; at?: string };
  before?: string;
  drops?: { column: string; item: string }[];
};
type Analysis = {
  summary: string;
  changed: boolean;
  columns: { name: string; role: string; why: string }[];
  unfound: { item: string }[];
  proposals: Proposal[];
  run?: { runId: string; model: string };
};
type Shown = { analysis: Analysis | null };

const md = () => readFileSync(join(P, "tests", ID, "test.md"), "utf8");
const steps = () => readTest(P, ID).test.steps;
const show = async () => (await call<Shown>("analysis.show", { id: ID }, P)).analysis as Analysis;

const LINK = `${D3}#§5.6.6 "Le menu contextuel d'un sectionneur sans TK propose" @Exigence "EXI_MOP_SPF_511_A_1670"`;
const TK = `${D3}#§5.6.6 "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés"`;

const good = {
  id: ID,
  summary: "Le test suit le §5.6.6.",
  columns: [
    { name: "Exigence", role: "open", why: "Texte libre." },
    { name: "Expected Result", role: "open", why: "Texte libre." },
  ],
  unfound: [{ step: 2, column: "Exigence", item: "EXI_MOP_SPF_510_A_20" }],
  proposals: [
    { kind: "source", step: 2, title: "Lier EXI_MOP_SPF_511_A_1670", why: "Le §5.6.6 l'énonce.", sources: [LINK] },
    {
      kind: "change",
      step: 1,
      column: "Exigence",
      value: "EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660",
      title: "Ajouter EXI_MOP_SPF_511_A_1660",
      why: "L'état est visible sur le symbole.",
      sources: [`${D3}#§5.6.6 "L'état ouvert ou fermé du sectionneur est visible" @Exigence "EXI_MOP_SPF_511_A_1660"`],
    },
    {
      kind: "step",
      after: 2,
      title: "Sectionneur avec TK",
      why: "Le §5.6.6 le distingue.",
      fields: {
        Action: "Clic droit sur un sectionneur avec TK.",
        "Expected Result": "Le menu ne propose que Propriétés.",
      },
      sources: [TK],
    },
    { kind: "remove", step: 5, title: "Retirer le step 5", why: "Aucun document ne le dit." },
  ],
};

beforeEach(() => {
  P = fixtureCopy("analysis");
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "claude" } });
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("analysis.record — what Claude proposes is proven before it is kept", () => {
  it("lists every problem at once and records nothing", async () => {
    const bad = {
      ...good,
      proposals: [
        {
          kind: "source",
          step: 2,
          title: "t",
          why: "w",
          sources: [`${D3}#§5.6.6 "ces mots ne sont nulle part dans le document"`],
        },
        { kind: "change", step: 2, column: "Exigence", value: "EXI_MOP_SPF_511_A_1670", title: "t", why: "w" },
        { kind: "remove", step: 9, title: "t", why: "w" },
        { kind: "step", after: 1, title: "t", why: "w", fields: { Action: "Faire." }, sources: [] },
      ],
    };
    const err = await invoke("analysis.record", bad, { project: P }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const text = (err as Error).message;
    expect(text).toContain("proposal 1 (source, step 2)");
    expect(text).toContain("is not in SOSIE_211_D401-1_3");
    expect(text).toContain('"EXI_MOP_SPF_510_A_20" must stay word for word');
    expect(text).toContain("proposal 3 (remove, step 9): step must be 1…5");
    expect(text).toContain("a new step needs an Action and an Expected Result");
    expect(text).toContain("a new step needs a source");
    expect(existsSync(join(P, "tests", ID, "analysis.json"))).toBe(false);
  });

  it("keeps a column nothing describes as the team's, whatever Claude says, and shows where each proposal lands", async () => {
    await call("analysis.record", good, P);
    const a = await show();
    expect(a.columns.find((c) => c.name === "Exigence")).toMatchObject({ role: "keep" });
    expect(a.unfound.map((u) => u.item)).toEqual(["EXI_MOP_SPF_510_A_20"]);
    expect(a.proposals.map((p) => [p.id, p.kind, p.state, p.now])).toEqual([
      ["p1", "source", "open", 2],
      ["p2", "change", "open", 1],
      ["p3", "step", "open", 2],
      ["p4", "remove", "open", 5],
    ]);
    expect(a.proposals[1].before).toBe("EXI_MOP_SPF_511_A_1650");
    expect(a.proposals[3].drops).toEqual([{ column: "Exigence", item: "EXI_MOP_SPF_511_A_1660" }]);
    expect(a.proposals[0].drops).toBeUndefined();
    expect(a.changed).toBe(false);
  });

  it("a Reference source column stays kept as written even when Claude calls it open", async () => {
    writeFileSync(
      join(P, "columns.json"),
      JSON.stringify([
        {
          name: "Exigence",
          id: "cf-exigence",
          description: "Les codes d'exigence.",
          mode: "open",
          referenceSource: true,
        },
      ]),
    );
    const change = { ...good.proposals[1], value: "EXI_MOP_SPF_511_A_1660" };
    const err = await invoke("analysis.record", { ...good, proposals: [change] }, { project: P }).catch((e) => e);
    expect(String(err)).toContain("Exigence is kept as written");
  });
});

describe("analysis.decide — the team decides each proposal", () => {
  beforeEach(async () => {
    await call("analysis.record", good, P);
  });

  it("accepting writes test.md at once; the test is never touched before", async () => {
    const before = md();
    expect(md()).toBe(before);
    const out = await call<{ applied: string[]; analysis: Analysis }>(
      "analysis.decide",
      { id: ID, proposals: ["p1", "p2", "p3"], decision: "accept" },
      P,
    );
    expect(out.applied).toEqual(["p1", "p2", "p3"]);
    const s = steps();
    expect(s).toHaveLength(6);
    expect(s[1].sources.at(-1)).toMatchObject({ column: "Exigence", item: "EXI_MOP_SPF_511_A_1670" });
    expect(s[0].fields.Exigence).toBe("EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660");
    expect(s[2].fields.Action).toBe("Clic droit sur un sectionneur avec TK.");
    expect(s[2].sources[0].quote).toBe("un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés");
    expect(out.analysis.proposals.filter((p) => p.state === "accepted")).toHaveLength(3);
    expect(out.analysis.proposals[3]).toMatchObject({ state: "open", now: 6 });
  });

  it("a step removed takes its other proposals with it, said as out of date", async () => {
    await call("analysis.decide", { id: ID, proposals: ["p4"], decision: "accept" }, P);
    expect(steps()).toHaveLength(4);
    const raw = JSON.parse(readFileSync(join(P, "tests", ID, "analysis.json"), "utf8"));
    raw.proposals.push({ ...raw.proposals[0], id: "p5", step: 5, state: "open" });
    writeFileSync(join(P, "tests", ID, "analysis.json"), JSON.stringify(raw));
    expect((await show()).proposals.find((p) => p.id === "p5")?.stale).toBe("Step 5 was removed.");
  });

  it("a step changed by hand since makes its proposals out of date, and accepting one is refused", async () => {
    writeFileSync(join(P, "tests", ID, "test.md"), md().replace("EXI_MOP_SPF_511_A_1650", "EXI_X"));
    const a = await show();
    expect(a.changed).toBe(true);
    expect(a.proposals[1].stale).toBe("Exigence of step 1 changed since the analysis.");
    expect(a.proposals[0].stale).toBeUndefined();
    const err = await invoke(
      "analysis.decide",
      { id: ID, proposals: ["p2"], decision: "accept" },
      { project: P },
    ).catch((e) => e);
    expect(err).toMatchObject({ code: "stale" });
  });

  it("reject keeps it aside, reopen brings it back; an accepted one is never rejected", async () => {
    await call("analysis.decide", { id: ID, proposals: ["p4"], decision: "reject" }, P);
    expect((await show()).proposals[3]).toMatchObject({ state: "rejected" });
    expect(steps()).toHaveLength(5);
    await call("analysis.decide", { id: ID, proposals: ["p4"], decision: "reopen" }, P);
    expect((await show()).proposals[3].state).toBe("open");
    await call("analysis.decide", { id: ID, proposals: ["p1"], decision: "accept" }, P);
    const err = await invoke(
      "analysis.decide",
      { id: ID, proposals: ["p1"], decision: "reject" },
      { project: P },
    ).catch((e) => e);
    expect(String(err)).toContain("already in the test");
  });
});

describe("an accepted proposal whose edit left the test is to decide again", () => {
  const file = () => join(P, "tests", ID, "test.md");
  const save = (t: Test) => writeTest(P, ID, t, fieldOrder(P));

  it("the test reverted (from Jira, by undo): every accepted proposal is open again, and accepted again", async () => {
    await call("analysis.record", good, P);
    const before = md();
    await call("analysis.decide", { id: ID, proposals: ["p1", "p2", "p3", "p4"], decision: "accept" }, P);
    expect(steps()).toHaveLength(5);
    writeFileSync(file(), before);
    const a = await show();
    expect(a.proposals.map((p) => p.state)).toEqual(["open", "open", "open", "open"]);
    expect(a.proposals[1]).toMatchObject({ now: 1, undone: { by: expect.any(String) } });
    expect(a.proposals[1].stale).toBeUndefined();
    expect(a.proposals[3]).toMatchObject({ now: 5 });
    await call("analysis.decide", { id: ID, proposals: ["p2", "p4"], decision: "accept" }, P);
    expect(steps()[0].fields.Exigence).toBe("EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660");
    expect(steps()).toHaveLength(4);
    const raw = JSON.parse(readFileSync(join(P, "tests", ID, "analysis.json"), "utf8"));
    expect(raw.proposals[1].state).toBe("accepted");
    expect(raw.proposals[1].undone).toBeUndefined();
  });

  it("an accepted change edited further by hand stays accepted; a source taken out is open again", async () => {
    await call("analysis.record", good, P);
    await call("analysis.decide", { id: ID, proposals: ["p1", "p2"], decision: "accept" }, P);
    writeFileSync(file(), md().replace("EXI_MOP_SPF_511_A_1660", "EXI_MOP_SPF_511_A_1660, EXI_Y"));
    expect((await show()).proposals[1].state).toBe("accepted");
    const t = readTest(P, ID).test;
    t.steps[1].sources = t.steps[1].sources.filter((s) => s.item !== "EXI_MOP_SPF_511_A_1670");
    save(t);
    const a = await show();
    expect(a.proposals[0]).toMatchObject({ state: "open", now: 2 });
    expect(a.proposals[0].undone).toBeDefined();
  });

  it("a step with no Xray id removed then brought back is open again; its twin left in place is not", async () => {
    writeFileSync(file(), md().replace(/ <!-- 10\d -->/g, ""));
    const twin = steps()[3];
    const t = readTest(P, ID).test;
    t.steps.splice(4, 1, { ...twin, fields: { ...twin.fields }, sources: [...twin.sources] });
    save(t);
    const before = md();
    await call("analysis.record", good, P);
    await call("analysis.decide", { id: ID, proposals: ["p4"], decision: "accept" }, P);
    expect(steps()).toHaveLength(4);
    expect((await show()).proposals[3].state).toBe("accepted");
    writeFileSync(file(), before);
    expect((await show()).proposals[3]).toMatchObject({ state: "open", now: 5 });
  });
});

describe("analysis.run — Claude reads, records, never edits", () => {
  const runs: ClaudeSpawn[] = [];
  function claude(record: boolean) {
    runs.length = 0;
    env.spawnClaude = async (s) => {
      if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
      runs.push(s);
      if (record) await invoke("analysis.record", good, { project: P });
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "t", name: "mcp__testimus__analysis_record", input: { id: ID } }],
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "4 propositions",
          session_id: "s",
        }),
      ];
      if (!record) lines.shift();
      for (const l of lines) s.onLine?.(l);
      return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
    };
  }

  it("runs the analyze-test skill with read tools and analysis_record only, then stamps its run", async () => {
    claude(true);
    const out = await call<{ ok: boolean; proposals: number }>(
      "analysis.run",
      { id: ID, note: "les exigences", model: "opus" },
      P,
    );
    expect(out).toMatchObject({ ok: true, proposals: 4 });
    const s = runs[0];
    expect(s.stdin).toContain("Use the analyze-test skill on the test LFRPS12-1420.");
    expect(s.stdin).toContain("les exigences");
    const allowed = s.args[s.args.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).toContain("mcp__testimus__analysis_record");
    expect(allowed).not.toContain("Edit");
    expect(allowed).not.toContain("mcp__testimus__tests_edit");
    expect(allowed).not.toContain("mcp__testimus__analysis_decide");
    expect((await show()).run).toMatchObject({ model: "opus" });
  });

  it("run again, Claude is told what the team accepted, rejected and left open, and a rejection is kept", async () => {
    await call("analysis.record", good, P);
    await call("analysis.decide", { id: ID, proposals: ["p3"], decision: "accept" }, P);
    await call("analysis.decide", { id: ID, proposals: ["p4"], decision: "reject" }, P);
    claude(true);
    expect(await call("analysis.run", { id: ID }, P)).toMatchObject({ ok: true });
    const sent = runs[0].stdin;
    expect(sent).toContain("This test was analysed before");
    expect(sent).toContain(
      "Accepted — in the test now, never propose to undo them:\n- step, after step 2: Sectionneur avec TK — Clic droit sur un sectionneur avec TK.",
    );
    expect(sent).toContain("Rejected — never propose them again, in any wording:\n- remove, step 6: Retirer le step 5");
    expect(sent).toMatch(
      /Not decided yet[^\n]*\n- source, step 2: Lier EXI_MOP_SPF_511_A_1670[^\n]*\n- change, step 1:/,
    );
    const raw = JSON.parse(readFileSync(join(P, "tests", ID, "analysis.json"), "utf8"));
    expect(raw.earlier).toEqual([expect.objectContaining({ kind: "remove", title: "Retirer le step 5" })]);
    claude(true);
    await call("analysis.run", { id: ID }, P);
    expect(runs[0].stdin).toMatch(/Rejected[^\n]*\n- remove: Retirer le step 5/);
    expect(JSON.parse(readFileSync(join(P, "tests", ID, "analysis.json"), "utf8")).earlier).toHaveLength(1);
  });

  it("a run that records nothing fails and leaves the last analysis as it was", async () => {
    await call("analysis.record", { ...good, summary: "La précédente." }, P);
    claude(false);
    const out = await call<{ ok: boolean; summary: string }>("analysis.run", { id: ID }, P);
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("analysis_record was not called");
    expect((await show()).summary).toBe("La précédente.");
  });
});
