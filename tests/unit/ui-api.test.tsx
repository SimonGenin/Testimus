// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call, fileUrl, run, setProject } from "../../src/ui/api.ts";
import { parseAnswer } from "../../src/ui/components/claude/AnswerText.tsx";
import { highlight } from "../../src/ui/components/sources/PassageDialog.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  setProject(null);
});

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("posts to /api/<group>/<verb> with the project header", async () => {
    const fetch = vi.fn(async () => reply(200, [{ id: "LFRPS12-1420" }]));
    vi.stubGlobal("fetch", fetch);
    setProject("C:\\Projets\\RATP Sosie");
    const r = await call("tests.list", { review: "checked" });
    expect(r).toEqual([{ id: "LFRPS12-1420" }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tests/list");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Testimus-Project"]).toBe(
      encodeURIComponent("C:\\Projets\\RATP Sosie"),
    );
    expect(JSON.parse(String(init.body))).toEqual({ review: "checked" });
  });

  it("throws ApiError with the fix on a 4xx", async () => {
    vi.stubGlobal("fetch", async () => reply(400, { error: "Jira 401", fix: "check credentials.json" }));
    const e = await call("xray.plan", { id: "x" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).message).toBe("Jira 401");
    expect((e as ApiError).fix).toBe("check credentials.json");
    expect((e as ApiError).status).toBe(400);
  });

  it("returns a plain result from run when the command is not a job", async () => {
    vi.stubGlobal("fetch", async () => reply(200, { version: "0.1.0" }));
    expect(await run("system.version", {})).toEqual({ version: "0.1.0" });
  });

  it("builds file URLs of the open project", () => {
    setProject("D:/p");
    expect(fileUrl("tests/LFRPS12-1420/images/fig 40.png")).toBe(
      "/files/tests/LFRPS12-1420/images/fig%2040.png?project=D%3A%2Fp",
    );
  });
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
