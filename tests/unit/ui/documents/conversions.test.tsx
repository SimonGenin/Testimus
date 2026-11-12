// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeFetch, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, doc, mountDocs } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const step = (id: string, status: "running" | "waiting") => ({ id, label: id, status });
const conversion = (id: string, waits: boolean): Job => ({
  id: `conv-${id}`,
  kind: "docs.convert",
  subject: id,
  status: "running",
  startedAt: at,
  message: waits ? "Waiting to convert (2 at a time)" : "Converting docx",
  steps: waits
    ? [step("queue", "running"), step("convert", "waiting"), step("index", "waiting")]
    : [step("convert", "running"), step("index", "waiting")],
});

describe("Several conversions at once", () => {
  it("shows each conversion going, those waiting their turn, and the index that takes each as it ends", async () => {
    const ids = ["A", "B", "C", "D"];
    api.routes["docs.list"] = () => ids.map((id) => doc(id, { converted: undefined, indexed: "missing" }));
    api.routes["rag.status"] = () => ({});
    api.routes["media.list"] = () => [];
    api.routes["docs.show"] = () => ({ doc: doc("A"), context: "", toc: [], figures: [], md: "" });
    api.routes["contexts.list"] = () => [];
    api.routes["jobs.list"] = () => ids.map((id, i) => conversion(id, i >= 2));
    setProject("C:\\p");
    mountDocs(<DocumentsScreen />);
    const list = await screen.findByRole("region", { name: "Document list" });
    expect(
      await within(list).findByText("Converting 2 at a time · 2 waiting · indexed as they end"),
    ).toBeInTheDocument();
    expect(within(list).getAllByRole("progressbar", { name: "Converting" })).toHaveLength(2);
    expect(within(list).getAllByText("Waiting to convert")).toHaveLength(2);
  });
});
