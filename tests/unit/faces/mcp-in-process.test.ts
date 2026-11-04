import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFixture, freshEnv, type Seen, tempRoot, withFakes } from "../helpers/faces.ts";

type Handler = (input: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const root = tempRoot("mcp");
const project = copyFixture(root);
const seen: Seen = { aborted: false, started: false };
const handlers = new Map<string, Handler>();
let factory: (() => unknown) | null = null;
let mcpFace: typeof import("../../../src/faces/mcp.ts");
const leaving: { killed: number; parentGone?: () => void; signal?: () => void } = { killed: 0 };

beforeAll(async () => {
  vi.resetModules();
  await freshEnv(root);
  const fakes = await withFakes(seen);
  vi.doMock("../../../src/core/commands/index.ts", () => fakes);
  vi.doMock("@modelcontextprotocol/server/stdio", () => ({
    serveStdio: (f: () => unknown) => {
      factory = f;
    },
  }));
  vi.doMock("../../../src/shared/run/process.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    killChildrenOnExit: () => {},
    killChildren: () => {
      leaving.killed++;
      return [];
    },
    onParentGone: (_stdin: unknown, gone: () => void) => {
      leaving.parentGone = gone;
    },
  }));
  vi.doMock("../../../src/core/shell.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    onStopSignals: (stop: () => void) => {
      leaving.signal = stop;
      return () => {};
    },
  }));
  const sdk = await import("@modelcontextprotocol/server");
  const original = sdk.McpServer.prototype.registerTool;
  vi.spyOn(sdk.McpServer.prototype, "registerTool").mockImplementation(function (this: unknown, ...a: unknown[]) {
    handlers.set(a[0] as string, a[2] as Handler);
    return (original as (...x: unknown[]) => unknown).apply(this, a) as never;
  });
  mcpFace = await import("../../../src/faces/mcp.ts");
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.doUnmock("../../../src/core/commands/index.ts");
  vi.doUnmock("@modelcontextprotocol/server/stdio");
});

const ctx = (
  token?: string | number,
  notify: (n: { params?: Record<string, unknown> }) => Promise<void> = async () => {},
) => ({
  mcpReq: {
    signal: new AbortController().signal,
    _meta: token === undefined ? undefined : { progressToken: token },
    notify,
  },
});

describe("MCP face in process", () => {
  it("serves the registry over stdio for the project it was given", async () => {
    await mcpFace.mcp(["--project", project]);
    expect(factory).not.toBeNull();
    const server = (factory as () => { server: unknown })();
    expect(server).toBeTruthy();
    expect(handlers.has("fake_job")).toBe(true);
    await mcpFace.mcp([]);
  });

  it("leaves once, killing what it started, when its parent goes or a stop signal comes", async () => {
    const exits: number[] = [];
    const exit = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      exits.push(code);
    }) as never);
    leaving.parentGone?.();
    leaving.signal?.();
    await vi.waitFor(() => expect(exits).toEqual([0]));
    expect(leaving.killed).toBe(1);
    exit.mockRestore();
  });

  it("returns a tool result as JSON text, null for nothing", async () => {
    const r = await handlers.get("fake_void")?.(undefined, ctx());
    expect(r).toEqual({ content: [{ type: "text", text: "null" }] });
    const info = await handlers.get("project_info")?.({}, ctx());
    expect(info?.isError).toBeUndefined();
  });

  it("returns errors as isError text, with the fix of a UserError", async () => {
    const boom = await handlers.get("fake_boom")?.({}, ctx());
    expect(boom).toEqual({ content: [{ type: "text", text: "boom" }], isError: true });
    const str = await handlers.get("fake_str")?.({}, ctx());
    expect(str?.content[0].text).toBe("plain text");
    const bad = await handlers.get("fake_void")?.({ x: "nope" }, ctx());
    expect(bad?.isError).toBe(true);
    expect(bad?.content[0].text).toContain("\ntestimus help fake.void");
  });

  it("waits for a job without a progress token", async () => {
    const r = await handlers.get("fake_job")?.({}, ctx());
    expect(JSON.parse(r?.content[0].text ?? "")).toEqual({ ok: true });
  });

  it("reports a job's progress to a client that asked, even when the client cannot take it", async () => {
    const sent: { params?: Record<string, unknown> }[] = [];
    const r = await handlers.get("fake_job")?.(
      {},
      ctx("tok", async (n: { params?: Record<string, unknown> }) => {
        sent.push(n);
        if (sent.length === 2) throw new Error("closed");
      }),
    );
    expect(JSON.parse(r?.content[0].text ?? "")).toEqual({ ok: true });
    expect(sent.map((n) => n.params?.message)).toEqual(["working [1/2]", "later", "counted [0/3]"]);
    expect(sent.map((n) => n.params?.progress)).toEqual([1, 2, 3]);
    expect(sent[0].params?.progressToken).toBe("tok");
  });

  it("fails a job tool when the job fails", async () => {
    const r = await handlers.get("fake_job")?.({ fail: "job broke" }, ctx(7));
    expect(r).toEqual({ content: [{ type: "text", text: "job broke" }], isError: true });
  });

  it("calls a command directly without an MCP request", async () => {
    const c = (await import("../../../src/core/commands/index.ts")).find("fake.void");
    expect(await mcpFace.callTool(c, null, {}, {} as never)).toBeUndefined();
  });
});
