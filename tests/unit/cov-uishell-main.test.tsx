// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/ui/app/App.tsx", () => ({ App: () => <p>the app</p> }));

describe("main", () => {
  it("renders the app into #root", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    await act(async () => {
      await import("../../src/ui/main.tsx");
    });
    expect(root).toContainElement(screen.getByText("the app"));
  });
});
