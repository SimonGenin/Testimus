// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandInfo } from "../../../../src/ui/api.ts";
import { CommandForm } from "../../../../src/ui/components/shell/CommandForm.tsx";
import { callsOf, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
});

const show: CommandInfo = {
  name: "tests.show",
  summary: "Show one test.",
  mutates: false,
  job: false,
  input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
};

describe("CommandForm keys", () => {
  it("runs the command on Ctrl+Enter in a field, and not on a key alone", async () => {
    net.routes["tests.show"] = (i) => ({ id: i.id, summary: "Ouvrir le sectionneur" });
    withData(<CommandForm command={show} onClose={() => {}} />);
    const id = screen.getByLabelText("id");
    fireEvent.change(id, { target: { value: "T-1" } });
    fireEvent.keyDown(id, { key: "Enter" });
    fireEvent.keyDown(id, { key: "a", ctrlKey: true });
    expect(callsOf("tests.show")).toEqual([]);
    fireEvent.keyDown(id, { key: "Enter", metaKey: true });
    await waitFor(() => expect(callsOf("tests.show").map((c) => c.input)).toEqual([{ id: "T-1" }]));
    expect(await screen.findByText(/Ouvrir le sectionneur/)).toBeInTheDocument();
  });
});
