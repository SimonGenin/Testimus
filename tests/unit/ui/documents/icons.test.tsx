// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocBadges as SourceBadges } from "../../../../src/ui/components/sources/PassageView.tsx";
import { ListItem } from "../../../../src/ui/components/ui/ListItem.tsx";
import { AppContext } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocHead } from "../../../../src/ui/screens/documents/DocHead.tsx";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { FigureImage } from "../../../../src/ui/screens/documents/FigureDetail.tsx";
import { UploadFailure, uploadItem } from "../../../../src/ui/screens/documents/UploadItem.tsx";
import { api, app, FakeEventSource, fakeDesktop, fakeFetch, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { doc, mountDocs } from "./helpers.tsx";

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
});

const iconOf = (el: Element | null | undefined) => el?.querySelector("[data-icon]")?.getAttribute("data-icon");

describe("the Documents icons, as the design draws them", () => {
  it("the list: a PDF is a file, a Word document documents; Not up to date warns, Not indexed is a danger", async () => {
    api.routes["docs.list"] = () => [
      doc("D1", { title: "Traction" }),
      doc("D2", { title: "Signalisation", indexed: "stale", source: { name: "", sha256: "", file: "source.pdf" } }),
      doc("D3", { title: "Alarmes", indexed: "missing" }),
    ];
    mountDocs(<DocumentsScreen />, { route: { screen: "documents" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    const row = (t: string) => within(list).getByText(t).closest('[role="option"]');
    await waitFor(() => expect(row("Traction")).not.toBeNull());
    expect(iconOf(row("Traction"))).toBe("documents");
    expect(iconOf(row("Signalisation"))).toBe("file");
    expect(iconOf(within(list).getByText("Not up to date"))).toBe("alert-triangle");
    expect(iconOf(within(list).getByText("Not indexed"))).toBe("alert-circle");
  });

  it("the reader's head: Documents panel-left, Details panel-right without a chevron, Show in Explorer folder-open", () => {
    fakeDesktop();
    setProject("C:\\p");
    render(
      <DocHead
        doc={doc("D1")}
        sections={3}
        figures={1}
        running={false}
        view="text"
        onView={() => {}}
        listOpen={false}
        onShowList={() => {}}
        sectionsButton={false}
        detailsButton
        drawer={null}
        onDrawer={() => {}}
        onConvertAgain={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(iconOf(screen.getByRole("button", { name: "Show the document list" }))).toBe("panel-left");
    const details = screen.getByRole("button", { name: "Details" });
    expect([...details.querySelectorAll("[data-icon]")].map((s) => s.getAttribute("data-icon"))).toEqual([
      "panel-right",
    ]);
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
    expect(iconOf(screen.getByRole("menuitem", { name: "Show in Explorer" }))).toBe("folder-open");
  });

  it("work under way: an index keeps the document's icon; a failure offers Open Jobs with jobs", () => {
    const u = {
      key: "k",
      name: "Traction",
      job: "index" as const,
      phase: "index-failed" as const,
      pct: null,
      message: "out of memory",
      docId: "D1",
    };
    const { container } = render(<ListItem {...uploadItem(u)} />);
    expect(iconOf(container)).toBe("documents");
    cleanup();
    render(
      <AppContext.Provider value={app()}>
        <UploadFailure u={u} />
      </AppContext.Provider>,
    );
    expect(iconOf(screen.getByRole("button", { name: "Open Jobs" }))).toBe("jobs");
  });

  it("a figure without its image shows the image icon; a source's status badge has the status icon", () => {
    render(<FigureImage docId="D1" figure={{ file: "", anchor: "fig:1", caption: "Plan", description: "" }} />);
    expect(document.querySelector('[data-icon="image"]')).not.toBeNull();
    cleanup();
    render(
      <>
        <SourceBadges status="draft" />
        <SourceBadges status="submitted" />
        <SourceBadges status="validated" />
      </>,
    );
    expect(iconOf(screen.getByText("Draft"))).toBe("circle-dashed");
    expect(iconOf(screen.getByText("Submitted"))).toBe("upload");
    expect(iconOf(screen.getByText("Validated"))).toBe("validated");
  });
});
