import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { Command } from "../../../src/core/command.ts";
import { BRIDGE_CALLS, SHELL_CALLS } from "../../../src/desktop/bridge-types.ts";
import { commandOf, inputFrom } from "../../../src/faces/cli-args.ts";
import { rawRequest } from "../helpers/faces.ts";

// ponytail: everything Testimus can do is a command of the registry, and every command answers on the three faces —
// so whatever the page does, a terminal and Claude (through MCP) can do too. The page side is held by the scan guards
// (guards.test.ts): N1a it calls only commands by their literal name, N1c through the data layer only, N1d the HTTP face
// serves no route of its own, N1e no face takes a domain module past the registry, N1f the desktop shell never imports
// the core. This file holds the other side: each face reaches every command, with every field of its input

let registry: Command[];
let find: (name: string) => Command;

beforeAll(async () => {
  ({ registry, find } = await import("../../../src/core/commands/index.ts"));
}, 120_000);

type Def = { type: string; [k: string]: unknown };
const defOf = (t: unknown) => (t as { _zod: { def: Def } })._zod.def;

// ponytail: one value of the field's type, shaped so the command line cannot read it as another type (« x1 », never
// « true » or « 2 » for a string)
function sample(t: z.ZodType, depth = 0): unknown {
  const d = defOf(t);
  if (depth > 4) return "x1";
  switch (d.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
      return sample(d.innerType as z.ZodType, depth);
    case "pipe":
      return sample(d.in as z.ZodType, depth);
    case "string":
      return "x1";
    case "number":
      return 2;
    case "boolean":
      return true;
    case "enum":
      return Object.values(d.entries as Record<string, string>)[0];
    case "literal":
      return (d.values as unknown[])[0];
    case "array":
      return [sample(d.element as z.ZodType, depth + 1)];
    case "object":
      return Object.fromEntries(
        Object.entries(d.shape as Record<string, z.ZodType>).map(([k, v]) => [k, sample(v, depth + 1)]),
      );
    case "record":
      return { k1: sample(d.valueType as z.ZodType, depth + 1) };
    case "union":
      return sample((d.options as z.ZodType[])[0], depth);
    default:
      return "x1";
  }
}

const flagOf = (key: string) => `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

function argvOf(input: Record<string, unknown>): string[] {
  return Object.entries(input).flatMap(([k, v]) => {
    if (v === true) return [flagOf(k)];
    if (Array.isArray(v) && v.every((x) => typeof x !== "object")) return v.flatMap((x) => [flagOf(k), String(x)]);
    return [flagOf(k), typeof v === "object" ? JSON.stringify(v) : String(v)];
  });
}

const shape = (c: Command) => (c.input as unknown as { shape: Record<string, z.ZodType> }).shape;

describe("every command can be driven from the command line, MCP and HTTP", () => {
  it("every command takes an object input (flags, an MCP tool's arguments, a JSON body)", () => {
    expect(registry.filter((c) => defOf(c.input).type !== "object").map((c) => c.name)).toEqual([]);
  });

  it("CLI: `testimus <group> <verb>`, its kebab-case form and `testimus <group.verb>` all find the command", () => {
    const lost: string[] = [];
    for (const c of registry) {
      const [group, verb] = c.name.split(".");
      const kebab = verb.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      for (const argv of [[group, verb], [group, kebab], [c.name]]) {
        const { name, args } = commandOf([...argv, "--x"]);
        if (name !== c.name || find(name) !== c || args.join(" ") !== "--x") lost.push(`${argv.join(" ")} → ${name}`);
      }
    }
    expect(lost).toEqual([]);
  });

  it("CLI: every input field is a flag that reaches the command with its value", () => {
    const lost: string[] = [];
    for (const c of registry) {
      const want = Object.fromEntries(Object.entries(shape(c)).map(([k, t]) => [k, sample(t)]));
      const got = inputFrom(c, argvOf(want)).input;
      for (const k of Object.keys(want))
        if (JSON.stringify(got[k]) !== JSON.stringify(want[k]))
          lost.push(
            `${c.name} ${flagOf(k)}: sent ${JSON.stringify(want[k])}, the command got ${JSON.stringify(got[k])}`,
          );
      for (const p of c.positional ?? []) if (!(p in want)) lost.push(`${c.name}: positional ${p} is no input field`);
    }
    expect(lost, lost.join("\n")).toEqual([]);
  });

  describe("MCP", () => {
    type Tool = (input: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    const tools = new Map<string, { schema: unknown; run: Tool }>();
    let toolName: (command: string) => string;

    beforeAll(async () => {
      const original = McpServer.prototype.registerTool;
      const spy = vi.spyOn(McpServer.prototype, "registerTool").mockImplementation(function (
        this: McpServer,
        ...a: unknown[]
      ) {
        tools.set(a[0] as string, { schema: (a[1] as { inputSchema: unknown }).inputSchema, run: a[2] as Tool });
        return (original as (...x: unknown[]) => unknown).apply(this, a) as never;
      });
      const face = await import("../../../src/faces/mcp.ts");
      toolName = face.toolName;
      face.buildServer(null);
      spy.mockRestore();
    });

    // ponytail: a secret never goes through an LLM's session (Command.mcp); any other command kept off MCP is a
    // capability Claude does not have — adding one here is a decision, not a fix
    it("every command is a tool, but the secrets", () => {
      expect(registry.filter((c) => c.mcp === false).map((c) => c.name)).toEqual(["system.secrets"]);
      expect([...tools.keys()].sort()).toEqual(
        registry
          .filter((c) => c.mcp !== false)
          .map((c) => toolName(c.name))
          .sort(),
      );
    });

    it("each tool takes the command's whole input and runs that command", async () => {
      const lost: string[] = [];
      for (const c of registry) {
        if (c.mcp === false) continue;
        const tool = tools.get(toolName(c.name));
        if (tool?.schema !== c.input) lost.push(`${c.name}: the tool's input is not the command's`);
        const ctx = { mcpReq: { signal: new AbortController().signal, notify: async () => {} } };
        const r = await tool?.run({ __probe: 1 }, ctx);
        const text = r?.content[0]?.text ?? "";
        if (!r?.isError || !text.includes(`Invalid input for ${c.name}`) || !text.includes("__probe"))
          lost.push(`${c.name}: ${text.slice(0, 120)}`);
      }
      expect(lost, lost.join("\n")).toEqual([]);
    });
  });

  describe("HTTP", () => {
    let server: Server;
    let port = 0;

    beforeAll(async () => {
      const http = await import("../../../src/faces/http.ts");
      const state = { project: null, mock: false, port: 0, token: "tok" };
      server = createServer(http.handler(state));
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      port = (server.address() as AddressInfo).port;
      state.port = port;
    });

    afterAll(() => server?.close());

    // ponytail: an unknown field is refused before the command runs, in words that name it — the route reached it
    it("POST /api/<group>/<verb> reaches every command", async () => {
      const lost: string[] = [];
      const body = JSON.stringify({ __probe: 1 });
      for (const c of registry) {
        const [group, verb] = c.name.split(".");
        const r = await rawRequest(port, `/api/${group}/${verb}`, {
          method: "POST",
          body,
          headers: {
            cookie: "testimus_session=tok",
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          },
        });
        if (r.status !== 400 || !r.text.includes(`Invalid input for ${c.name}`) || !r.text.includes("__probe"))
          lost.push(`${c.name}: ${r.status} ${r.text.slice(0, 120)}`);
      }
      expect(lost, lost.join("\n")).toEqual([]);
    });
  });

  // ponytail: the desktop bridge carries presentation only (dialogs, Explorer, the taskbar, notifications, the window);
  // a call added here that does project work is a capability only the window has — it belongs in a command
  it("the desktop bridge carries its presentation calls only", () => {
    expect([...BRIDGE_CALLS]).toEqual([
      "version",
      "pickFolder",
      "pickFiles",
      "reveal",
      "openExternal",
      "setProgress",
      "notify",
      "setAlwaysOnTop",
      "relaunch",
    ]);
    expect([...SHELL_CALLS]).toEqual(["details", "restart", "openLogs"]);
  });
});
