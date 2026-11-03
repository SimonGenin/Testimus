import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { call, fixtureCopy } from "../registry.ts";

const DOC = "SOSIE_211_D401-1_3";
const TEST = "LFRPS12-1420";

type Listed = {
  id: string;
  title: string;
  where: string;
  state: string;
  stale: boolean;
  plan: string[];
  scope: { kind: string };
  suggest: { model: string; effort: string };
  proposedBy: { run: string; model: string; effort: string };
};

let P = "";
beforeEach(() => {
  P = fixtureCopy("actions-reg");
});

const propose = (over: Record<string, unknown> = {}) =>
  call<Listed>(
    "actions.propose",
    {
      title: "Cite the source of step 2",
      scope: { kind: "step", testId: TEST, step: 2 },
      problem: "Step 2 has no source",
      why: "The behaviour is in §5.6.6.",
      plan: ["Find the passage", "Add the source line"],
      ...over,
    },
    P,
  );

describe("actions.list and actions.show through the registry", () => {
  it("lists the open actions, filtered by document or by test", async () => {
    expect(await call("actions.list", {}, P)).toEqual([]);
    const onTest = await propose();
    const onDoc = await propose({
      title: "Redraw figure 41",
      scope: { kind: "doc", docId: DOC },
      problem: "Figure 41 is a shape drawn in Word",
      plan: ["Read the labels", "Describe the figure"],
    });
    const all = await call<Listed[]>("actions.list", {}, P);
    expect(all.map((a) => a.id).sort()).toEqual([onTest.id, onDoc.id].sort());
    expect((await call<Listed[]>("actions.list", { docId: DOC }, P)).map((a) => a.id)).toEqual([onDoc.id]);
    expect((await call<Listed[]>("actions.list", { testId: TEST }, P)).map((a) => a.id)).toEqual([onTest.id]);
    expect(await call("actions.list", { jobId: "nope" }, P)).toEqual([]);
  });

  it("hides a dismissed action unless all is asked, and states it", async () => {
    const a = await propose();
    await call("actions.dismiss", { id: a.id }, P);
    expect(await call("actions.list", {}, P)).toEqual([]);
    const all = await call<Listed[]>("actions.list", { all: true }, P);
    expect(all.map((x) => [x.id, x.state])).toEqual([[a.id, "dismissed"]]);
  });

  it("marks an action stale once its test changed, and lists it only with all", async () => {
    const a = await propose();
    const file = join(P, "tests", TEST, "test.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("Clic droit sur", "Double clic sur"));
    expect(await call("actions.list", {}, P)).toEqual([]);
    const all = await call<Listed[]>("actions.list", { all: true }, P);
    expect(all).toMatchObject([{ id: a.id, stale: true, state: "open" }]);
  });

  it("actions.show reads one action back with its plan, model and effort", async () => {
    const a = await propose({ model: "haiku", effort: "low" });
    const shown = await call<Listed>("actions.show", { id: a.id }, P);
    expect(shown).toMatchObject({
      id: a.id,
      title: "Cite the source of step 2",
      where: `test:${TEST}`,
      state: "open",
      stale: false,
      plan: ["Find the passage", "Add the source line"],
      scope: { kind: "step" },
      suggest: { model: "haiku", effort: "low" },
      proposedBy: { run: "claude", model: "", effort: "" },
    });
    const plain = await propose({ title: "Other", problem: "Another problem" });
    expect((await call<Listed>("actions.show", { id: plain.id }, P)).suggest).toEqual({
      model: "sonnet",
      effort: "medium",
    });
  });

  it("actions.show refuses an id that is not an action id, and an unknown one", async () => {
    await expect(call("actions.show", { id: "x-1" }, P)).rejects.toThrow(/Invalid input for actions.show/);
    await expect(call("actions.show", { id: "act-nope" }, P)).rejects.toThrow();
    await expect(call("actions.list", {}, null)).rejects.toThrow(/No project is open/);
  });
});
