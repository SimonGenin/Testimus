// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandInfo } from "../../src/ui/api.ts";
import { CommandForm, plannedFirst } from "../../src/ui/components/shell/CommandForm.tsx";

type Call = { name: string; input: Record<string, unknown> };
let calls: Call[] = [];
let routes: Record<string, (input: Record<string, unknown>) => unknown> = {};

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const named = (n: string) => calls.filter((c) => c.name === n);

const command = (name: string, props: Record<string, { type: string; enum?: string[] }>): CommandInfo => ({
  name,
  summary: name,
  mutates: true,
  job: name === "xray.push",
  input: { type: "object", properties: props } as CommandInfo["input"],
});

describe("palette never writes to Jira blind", () => {
  it("knows which commands are planned first", () => {
    expect(plannedFirst("xray.push", { id: "LFRPS12-1420" })).toBe("push");
    expect(plannedFirst("xray.push", { id: "LFRPS12-1420", dryRun: true })).toBeNull();
    expect(plannedFirst("xray.fields", {})).toBeNull();
  });

  it("opens the push plan dialog and pushes with its planHash", async () => {
    routes["xray.plan"] = () => ({
      testId: "LFRPS12-1420",
      ops: [{ kind: "update", label: "Update the summary" }],
      warnings: [],
      remoteChanged: false,
      review: "validated",
      planHash: "h-7",
    });
    routes["xray.push"] = () => ({
      ok: true,
      id: "LFRPS12-1420",
      ops: [{ label: "Update the summary", status: "done" }],
    });
    render(<CommandForm command={command("xray.push", { id: { type: "string" } })} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("id (optional)"), { target: { value: "LFRPS12-1420" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const confirm = await screen.findByRole("button", { name: "Confirm push" });
    expect(named("xray.push")).toHaveLength(0);
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(named("xray.push")).toHaveLength(1));
    expect(named("xray.push")[0].input).toEqual({ id: "LFRPS12-1420", planHash: "h-7" });
  });
});
