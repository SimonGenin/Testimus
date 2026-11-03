// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnsSection } from "../../../../src/ui/screens/settings/ColumnsSection.tsx";
import { clearToasts, mount } from "../../cov-uiscreens-helpers.tsx";
import { api, app, fakeFetch, named, noDesktop } from "../../ui-desktop-helpers.tsx";

beforeEach(() => fakeFetch());

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const xray = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true, required: true },
    { id: "cf1", name: "Exigence", type: "text-single", builtin: false, required: true },
    { id: "cf2", name: "Ancienne", type: "text-single", builtin: false, disabled: true },
  ],
  columns: [],
  fetchedAt: "2026-11-01T10:00:00Z",
} as unknown as ReturnType<typeof app>["xray"];

const col = (name: string, mode = name === "Ancienne" ? "filled" : "open") => ({
  name,
  origin: "xray",
  builtin: name === "Action" || name === "Expected Result",
  status: "ok",
  description: `${name} text`,
  mode,
});

const info = (opened = false) =>
  ({
    ...app().info,
    columns: ["Action", "Expected Result", "Exigence", "Ancienne"].map((n) =>
      col(n, opened || n !== "Ancienne" ? "open" : "filled"),
    ),
  }) as ReturnType<typeof app>["info"];

const row = (name: string) =>
  within(screen.getByRole("list", { name: "Smart columns" }))
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(name)) as HTMLElement;

describe("Settings › Smart columns: a field Xray requires or has switched off (audit M-T5)", () => {
  it("lists a required field and an off field as columns read from Xray", () => {
    mount(<ColumnsSection />, { xray, info: info() });
    expect(row("Exigence")).toHaveTextContent("Xray");
    expect(row("Ancienne")).toHaveTextContent("Xray");
    expect(row("Expected Result")).toHaveTextContent("Xray · standard");
  });

  it("folds a field switched off in Xray as « when filled » until it is set open", async () => {
    api.routes["columns.setModes"] = () => [];
    mount(<ColumnsSection />, { xray, info: info() });
    expect(screen.getByLabelText("Ancienne folding")).toHaveValue("filled");
    expect(screen.getByLabelText("Exigence folding")).toHaveValue("open");
    fireEvent.change(screen.getByLabelText("Ancienne folding"), { target: { value: "open" } });
    await waitFor(() => expect(named("columns.setModes")[0]?.input).toEqual({ modes: { Ancienne: "open" } }));
  });

  it("shows an off field set open as open", () => {
    mount(<ColumnsSection />, { xray, info: info(true) });
    expect(screen.getByLabelText("Ancienne folding")).toHaveValue("open");
  });
});
