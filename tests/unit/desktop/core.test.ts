import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coreEnv,
  coreLaunch,
  findNode,
  jobLine,
  localOrigin,
  parseReady,
  quitDecision,
  type RunningJob,
  SERVE_FLAGS,
  shellArgs,
} from "../../../src/desktop/core.ts";

describe("ready line", () => {
  it("reads the line serve --ready-json writes", () => {
    expect(parseReady('{"ready":true,"url":"http://127.0.0.1:53211/","pid":4242,"version":"0.2.0"}')).toEqual({
      url: "http://127.0.0.1:53211/",
      origin: "http://127.0.0.1:53211",
      pid: 4242,
      version: "0.2.0",
    });
  });

  it("accepts localhost and a url without its slash", () => {
    expect(parseReady('{"ready":true,"url":"http://localhost:4317"}')?.url).toBe("http://localhost:4317/");
  });

  it("ignores log lines, broken JSON and lines that are not ready", () => {
    expect(parseReady("Testimus on http://localhost:4317/")).toBeNull();
    expect(parseReady('{"ready":true,"url":')).toBeNull();
    expect(parseReady('{"ready":false,"url":"http://127.0.0.1:1/"}')).toBeNull();
    expect(parseReady('{"url":"http://127.0.0.1:1/"}')).toBeNull();
    expect(parseReady("[1,2]")).toBeNull();
    expect(parseReady("")).toBeNull();
  });

  it("refuses a url that is not a local http address with a port", () => {
    expect(parseReady('{"ready":true,"url":"https://127.0.0.1:4317/"}')).toBeNull();
    expect(parseReady('{"ready":true,"url":"http://evil.example:4317/"}')).toBeNull();
    expect(parseReady('{"ready":true,"url":"http://127.0.0.1/"}')).toBeNull();
    expect(parseReady('{"ready":true,"url":"http://user:pw@127.0.0.1:4317/"}')).toBeNull();
    expect(parseReady('{"ready":true,"url":"file:///C:/x"}')).toBeNull();
  });

  it("drops a pid that is not an integer", () => {
    expect(parseReady('{"ready":true,"url":"http://127.0.0.1:5/","pid":"12"}')?.pid).toBeUndefined();
  });

  it("localOrigin keeps the origin only", () => {
    expect(localOrigin("http://[::1]:4317/x?y")).toBe("http://[::1]:4317");
    expect(localOrigin("not a url")).toBeNull();
  });
});

describe("core launch", () => {
  it("runs the developer's Node on the source checkout", () => {
    const l = coreLaunch({ packaged: false, exeDir: "X", repo: "D:\\repo", node: "C:\\n\\node.exe", mock: true });
    expect(l.command).toBe("C:\\n\\node.exe");
    expect(l.args).toEqual([join("D:\\repo", "src", "faces", "cli.ts"), ...SERVE_FLAGS, "--mock"]);
    expect(l.cwd).toBe("D:\\repo");
  });

  it("runs the shipped node.exe on the bundle next to Testimus.exe", () => {
    const l = coreLaunch({ packaged: true, exeDir: "C:\\T\\0.2.0", repo: "", node: null, mock: false });
    expect(l.command).toBe(join("C:\\T\\0.2.0", "node", "node.exe"));
    expect(l.args).toEqual([join("C:\\T\\0.2.0", "app", "testimus.mjs"), ...SERVE_FLAGS]);
    expect(SERVE_FLAGS).toEqual(["serve", "--port", "0", "--no-open", "--ready-json", "--exit-with-stdin"]);
  });

  it("opens the folder given on the command line from the core's start (no race with the UI), never under --mock", () => {
    const real = coreLaunch({ packaged: true, exeDir: "C:/T", repo: "", node: null, mock: false, project: "D:\\proj" });
    expect(real.args.slice(-2)).toEqual(["--project", "D:\\proj"]);
    const mock = coreLaunch({ packaged: true, exeDir: "C:/T", repo: "", node: null, mock: true, project: "D:\\proj" });
    expect(mock.args).not.toContain("--project");
  });

  it("asks for the port of the last run, with a fallback when it is taken", () => {
    const l = coreLaunch({ packaged: true, exeDir: "C:/T", repo: "", node: null, mock: false, port: 51234 });
    expect(l.args.slice(1)).toEqual([
      "serve",
      "--port",
      "51234",
      "--no-open",
      "--ready-json",
      "--exit-with-stdin",
      "--port-fallback",
    ]);
  });

  it("says what to do when Node is missing in development", () => {
    expect(() => coreLaunch({ packaged: false, exeDir: "", repo: "", node: null, mock: false })).toThrow(
      /TESTIMUS_NODE/,
    );
  });

  it("finds node on the PATH, or TESTIMUS_NODE first", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const exe = process.platform === "win32" ? "node.exe" : "node";
    const has = (p: string) => p === join("C:\\b", exe);
    expect(findNode({ PATH: ["C:\\a", '"C:\\b"', ""].join(sep) }, has)).toBe(join("C:\\b", exe));
    expect(findNode({ PATH: "C:\\a" }, has)).toBeNull();
    expect(findNode({ TESTIMUS_NODE: "D:\\n.exe", PATH: "C:\\b" }, (p) => p === "D:\\n.exe")).toBe("D:\\n.exe");
    expect(findNode({ TESTIMUS_NODE: "D:\\missing.exe", PATH: "C:\\b" }, has)).toBeNull();
  });

  it("tells the core it runs in the shell and never as Electron's Node", () => {
    const env = coreEnv(
      { PATH: "x", ELECTRON_RUN_AS_NODE: "1" },
      { shellVersion: "0.2.0", packaged: false, exeDir: "E" },
    );
    expect(env.TESTIMUS_SHELL).toBe("desktop/0.2.0");
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.TESTIMUS_HOME_BIN).toBeUndefined();
    const rel = coreEnv({}, { shellVersion: "0.2.0", packaged: true, exeDir: "C:\\T" });
    expect(rel.TESTIMUS_HOME_BIN).toBe("C:\\T");
    expect(rel.NODE_USE_ENV_PROXY).toBe("1");
    expect(rel.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });

  it("keeps the user's NO_PROXY and appends the loopback names when the proxy is used", () => {
    const opts = { shellVersion: "0.2.0", packaged: true, exeDir: "C:\\T" };
    expect(coreEnv({ NO_PROXY: "corp.example" }, opts).NO_PROXY).toBe("corp.example,localhost,127.0.0.1,::1");
    const lower = coreEnv({ no_proxy: ".corp,localhost" }, opts);
    expect(lower.no_proxy).toBeUndefined();
    expect(lower.NO_PROXY).toBe(".corp,localhost,127.0.0.1,::1");
    expect(coreEnv({ NO_PROXY: "localhost,127.0.0.1,::1" }, opts).NO_PROXY).toBe("localhost,127.0.0.1,::1");
    const dev = coreEnv({ NO_PROXY: "corp.example" }, { ...opts, packaged: false });
    expect(dev.NO_PROXY).toBe("corp.example");
    const devProxy = coreEnv({ NODE_USE_ENV_PROXY: "1" }, { ...opts, packaged: false });
    expect(devProxy.NO_PROXY).toBe("localhost,127.0.0.1,::1");
  });

  it("reads --mock, --ui-dev and a folder from the command line", () => {
    const dirs = new Set([join("D:\\", "proj")]);
    const a = shellArgs(["Testimus.exe", "--inspect=0", "dist/desktop/main.mjs", "--mock", "proj"], "D:\\", (p) =>
      dirs.has(p),
    );
    expect(a).toEqual({ mock: true, uiDev: false, folder: join("D:\\", "proj") });
    expect(shellArgs(["electron", "main.mjs", "--ui-dev"], "D:\\", () => false)).toEqual({
      mock: false,
      uiDev: true,
      folder: null,
    });
  });
});

describe("quit", () => {
  const job = (over: Partial<RunningJob>): RunningJob => ({
    id: "j1",
    kind: "generate",
    subject: "Le sectionneur",
    status: "running",
    ...over,
  });

  it("quits at once when nothing runs", () => {
    expect(quitDecision([])).toEqual({ ask: false });
  });

  it("names each running job with its progress", () => {
    const d = quitDecision([
      job({ progress: { done: 12, total: 40 } }),
      job({ id: "j2", kind: "rag-index", subject: "", progress: { done: 0, total: 0 } }),
    ]);
    expect(d.ask).toBe(true);
    if (!d.ask) return;
    expect(d.message).toBe("2 jobs are still running.");
    expect(d.detail).toContain("Generate tests · Le sectionneur — 12/40");
    expect(d.detail).toContain("Index documents — running");
  });

  it("keeps an unknown kind and shortens a long subject", () => {
    expect(jobLine(job({ kind: "other", subject: "x".repeat(80) }))).toMatch(/^other · x{59}… — running$/);
    const one = quitDecision([job({})]);
    expect(one.ask && one.message).toBe("A job is still running.");
  });
});
