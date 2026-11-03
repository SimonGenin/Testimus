// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushDialog } from "../../src/ui/screens/tests/PushDialog.tsx";

type Call = { name: string; input: Record<string, unknown> };
let calls: Call[] = [];
let remoteChanged = false;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const body =
        name === "xray.plan"
          ? {
              testId: "LFRPS12-1420",
              key: "LFRPS12-1420",
              ops: [{ kind: "update", label: "Update the summary" }],
              warnings: [],
              remoteChanged,
              review: "validated",
              planHash: "h-42",
            }
          : { ok: true, id: "LFRPS12-1420", ops: [{ label: "Update the summary", status: "done" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dialog = () =>
  render(
    <PushDialog
      testId="LFRPS12-1420"
      testKey="LFRPS12-1420"
      summary="Sectionneur sans TK"
      review="validated"
      onDone={() => {}}
      onClose={() => {}}
    />,
  );

describe("PushDialog", () => {
  it("confirms with the plan hash and never overwrites Jira on its own", async () => {
    remoteChanged = false;
    dialog();
    const confirm = await screen.findByRole("button", { name: "Confirm push" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.name === "xray.push")).toBe(true));
    const push = calls.find((c) => c.name === "xray.push");
    expect(push?.input).toEqual({ id: "LFRPS12-1420", planHash: "h-42" });
  });

  it("shows a change made in Jira in the plan, and confirming pushes over it (Xray Editor)", async () => {
    remoteChanged = true;
    dialog();
    const confirm = await screen.findByRole("button", { name: "Confirm push" });
    await screen.findByText("Changed in Jira since your pull");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.name === "xray.push")).toBe(true));
    expect(calls.find((c) => c.name === "xray.push")?.input).toEqual({
      id: "LFRPS12-1420",
      planHash: "h-42",
      overwriteRemote: true,
    });
  });
});
