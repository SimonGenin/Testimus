import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelJobs, quitDecision, runningJobs, sessionCookie } from "../../../src/desktop/core.ts";

type Seen = { url: string; cookie?: string; origin?: string; project?: string; body: string };

let server: Server;
let origin = "";
const seen: Seen[] = [];
const P1 = "D:\\p\\one";
const P2 = "D:\\p\\two";

const read = (req: IncomingMessage) =>
  new Promise<string>((r) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
    });
    req.on("end", () => r(s));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await read(req);
    const project = req.headers["x-testimus-project"];
    seen.push({
      url: req.url ?? "",
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      project: typeof project === "string" ? decodeURIComponent(project) : undefined,
      body,
    });
    if (req.url === "/") {
      res.writeHead(200, { "set-cookie": "testimus_session=abc123; Path=/; HttpOnly; SameSite=Strict" });
      res.end("<html></html>");
      return;
    }
    if (req.headers.cookie !== "testimus_session=abc123") {
      res.writeHead(403);
      res.end('{"error":"No Testimus session"}');
      return;
    }
    const json = (v: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (req.url === "/api/project/list")
      return json({
        last: P1,
        projects: [
          { dir: P1, exists: true },
          { dir: P2, exists: true },
          { dir: "D:\\gone", exists: false },
        ],
      });
    if (req.url === "/api/jobs/list") {
      const pid = 777;
      if (decodeURIComponent(String(project)) === P1)
        return json([
          {
            id: "g1",
            kind: "generate",
            subject: "Sectionneur",
            status: "running",
            pid,
            progress: { done: 12, total: 40 },
          },
          { id: "old", kind: "check", subject: "", status: "running", pid: 999 },
        ]);
      return json([{ id: "i1", kind: "rag-index", subject: "", status: "running", pid }]);
    }
    if (req.url === "/api/jobs/cancel") return json({ cancelled: true });
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.close();
});

describe("quit decision from jobs.list", () => {
  it("gets the session cookie the way the window does", async () => {
    expect(await sessionCookie(origin)).toBe("testimus_session=abc123");
  });

  it("asks every known project for its running jobs of this core, with the cookie and no Origin", async () => {
    seen.length = 0;
    const jobs = await runningJobs(origin, "testimus_session=abc123", 777);
    expect(jobs.map((j) => [j.id, j.project])).toEqual([
      ["g1", P1],
      ["i1", P2],
    ]);
    const lists = seen.filter((s) => s.url === "/api/jobs/list");
    expect(lists.map((s) => s.project)).toEqual([P1, P2]);
    expect(lists.every((s) => s.cookie === "testimus_session=abc123" && s.origin === undefined)).toBe(true);
    expect(JSON.parse(lists[0].body)).toEqual({ running: true });
    const d = quitDecision(jobs);
    expect(d.ask && d.detail).toContain("Generate tests · Sectionneur — 12/40");
  });

  it("cancels each job in its own project", async () => {
    seen.length = 0;
    const jobs = await runningJobs(origin, "testimus_session=abc123", 777);
    await cancelJobs(origin, "testimus_session=abc123", jobs);
    const cancels = seen.filter((s) => s.url === "/api/jobs/cancel");
    expect(cancels.map((s) => [JSON.parse(s.body).id, s.project])).toEqual([
      ["g1", P1],
      ["i1", P2],
    ]);
  });

  it("quits without asking when the core refuses or is gone", async () => {
    expect(await runningJobs(origin, "testimus_session=wrong", 777)).toEqual([]);
    expect(await runningJobs("http://127.0.0.1:1", "", 777)).toEqual([]);
  });
});
