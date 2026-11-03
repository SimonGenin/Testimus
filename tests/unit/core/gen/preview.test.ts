import { describe, expect, it } from "vitest";
import { markIndexedInDb } from "../../index-state-helpers.ts";
import { call, fixtureCopy } from "../registry.ts";

type Preview = { replaces: string[]; searched: string[]; unindexed: string[]; stale: string[] };
type Ref = { id: string; key?: string; generated: boolean; review: string };

const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";

describe("gen.preview: what a generation would do, before it runs (GOAL-V3 N1)", () => {
  it("names the tests discard would replace: Claude's tests awaiting review, never one in Jira", async () => {
    const P = fixtureCopy("gen-preview");
    const refs = await call<Ref[]>("tests.list", {}, P);
    const awaiting = refs.filter((t) => t.generated && t.review !== "validated" && !t.key).map((t) => t.id);
    const p = await call<Preview>("gen.preview", {}, P);
    expect(p.replaces.sort()).toEqual(awaiting.sort());
    expect(p.replaces.length).toBeGreaterThan(0);
    expect(refs.filter((t) => t.key).every((t) => !p.replaces.includes(t.id))).toBe(true);
  });

  it("says which documents in scope are not indexed or changed since their index", async () => {
    const P = fixtureCopy("gen-preview-index");
    expect(await call<Preview>("gen.preview", { docs: [D3] }, P)).toMatchObject({
      searched: [D3],
      unindexed: [D3],
      stale: [],
    });
    markIndexedInDb(P, [D3], { [D3]: "an older text" });
    expect(await call<Preview>("gen.preview", { sections: [`${D3}#§5.6.6`] }, P)).toMatchObject({
      searched: [D3],
      unindexed: [],
      stale: [D3],
    });
    markIndexedInDb(P);
    const all = await call<Preview>("gen.preview", {}, P);
    expect(all.searched.sort()).toEqual([D3, D4]);
    expect(all).toMatchObject({ unindexed: [], stale: [] });
  });
});
