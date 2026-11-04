// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call, fileUrl, run, setProject } from "../../../../src/ui/api.ts";

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

  it("follows a job in the project it was started in, after the page moved to another project", async () => {
    vi.useFakeTimers();
    try {
      let state = "running";
      const asked: { name: string; project: string }[] = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        const where = decodeURIComponent((init.headers as Record<string, string>)["X-Testimus-Project"] ?? "");
        asked.push({ name: url, project: where });
        if (url === "/api/xray/pull") return reply(200, { jobId: "pull-1" });
        if (where !== "C:\\A") return reply(400, { error: "No job pull-1." });
        return reply(200, { job: { id: "pull-1", kind: "pull", status: state, result: { pulled: ["K-1"] } } });
      });
      setProject("C:\\A");
      const done = run<{ pulled: string[] }>("xray.pull", { key: "K-1" });
      await vi.advanceTimersByTimeAsync(0);
      setProject("C:\\B");
      state = "done";
      await vi.advanceTimersByTimeAsync(1500);
      expect(await done).toEqual({ pulled: ["K-1"] });
      expect(asked.filter((a) => a.name === "/api/jobs/show").map((a) => a.project)).toEqual(["C:\\A", "C:\\A"]);
      const n = asked.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(asked).toHaveLength(n);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops following a job its project no longer knows, and says so", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      vi.stubGlobal("fetch", async (url: string) => {
        calls++;
        if (url === "/api/xray/pull") return reply(200, { jobId: "pull-2" });
        return reply(404, { error: "No job pull-2." });
      });
      setProject("C:\\A");
      const done = run("xray.pull", { key: "K-1" }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      const e = await done;
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toBe("No job pull-2.");
      const n = calls;
      await vi.advanceTimersByTimeAsync(6000);
      expect(calls).toBe(n);
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds file URLs of the open project", () => {
    setProject("D:/p");
    expect(fileUrl("tests/LFRPS12-1420/images/fig 40.png")).toBe(
      "/files/tests/LFRPS12-1420/images/fig%2040.png?project=D%3A%2Fp",
    );
  });
});
