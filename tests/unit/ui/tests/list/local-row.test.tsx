// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTestRef } from "../../../../../src/core/types.ts";
import { setProject } from "../../../../../src/ui/api.ts";
import { AppContext } from "../../../../../src/ui/lib/app.ts";
import { TestList } from "../../../../../src/ui/screens/tests/TestList.tsx";
import { app } from "../../../helpers/ui-desktop.tsx";
import { server, stubServer } from "../../../helpers/ui-server.ts";
import { testClient, WithData } from "../data-helpers.tsx";

const ref = (o: Partial<LocalTestRef> & { id: string }): LocalTestRef => ({
  summary: o.id,
  folder: "/",
  review: "draft",
  generated: false,
  edited: false,
  sync: "local",
  dirty: false,
  synced: false,
  mtime: Date.now(),
  stepCount: 1,
  ...o,
});

const refs: LocalTestRef[] = [
  ref({ id: "t-1", summary: "Ouverture du sectionneur", key: "LFRPS12-1", sync: "synced", synced: true }),
  ref({ id: "t-2", summary: "Fermeture du disjoncteur", key: "LFRPS12-2", sync: "modified", dirty: true }),
  ref({ id: "t-3", summary: "Changé dans Jira", key: "LFRPS12-3", sync: "remote-changed", synced: true }),
  ref({ id: "t-4", summary: "Brouillon local", sync: "local" }),
];

let seq = 0;

beforeEach(() => {
  stubServer();
  setProject(`C:\\local-row-${++seq}`);
  server.routes["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
  server.routes["jobs.list"] = () => [];
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const row = (summary: string) =>
  screen.getAllByRole("treeitem").find((r) => r.textContent?.startsWith(summary)) as HTMLElement;

describe("TestList › a local row", () => {
  it("shows its summary, its key and its sync state, and a ✕ that deletes the local copy", () => {
    render(
      <WithData client={testClient()}>
        <AppContext.Provider value={app()}>
          <TestList refs={refs} loading={false} activeId="" onOpen={vi.fn()} onReload={vi.fn(async () => refs)} />
        </AppContext.Provider>
      </WithData>,
    );
    const cases: [string, string, string][] = [
      ["Ouverture du sectionneur", "LFRPS12-1", "In sync"],
      ["Fermeture du disjoncteur", "LFRPS12-2", "Modified"],
      ["Changé dans Jira", "LFRPS12-3", "Changed in Jira"],
      ["Brouillon local", "no key", "Local only"],
    ];
    for (const [summary, key, state] of cases) {
      const r = row(summary);
      expect(within(r).getByText(key)).toBeInTheDocument();
      expect(within(r).getByText(state)).toBeInTheDocument();
      fireEvent.focus(r);
      expect(within(r).getByRole("button", { name: /^Delete the local copy/ })).toBeInTheDocument();
    }
  });
});
