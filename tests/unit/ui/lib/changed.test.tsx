// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { touches, useChanged } from "../../../../src/ui/lib/changed.ts";
import { FakeES, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { app as appState } from "../../ui-desktop-helpers.tsx";

vi.mock("../../../../src/ui/screens/tests/TestsScreen.tsx", async () => {
  const { useApp } = await import("../../../../src/ui/lib/app.ts");
  return {
    TestsScreen: () => <output aria-label="tests nonce">{useApp().testsNonce}</output>,
  };
});
vi.mock("../../../../src/ui/components/claude/ClaudeDock.tsx", () => ({ ClaudeDock: () => null }));

const changed = (paths: string[]) =>
  act(() => FakeES.emit({ jobId: "j", at: "2026-11-03T10:00:00.000Z", type: "changed", paths }));

beforeEach(() => {
  fakeNet();
  fakeEvents();
  window.location.hash = "";
  net.api = () => ({ project: "C:\\p", mock: true, commands: [] });
  net.routes["project.info"] = () => appState().info;
  net.routes["system.credentials"] = net.routes["system.setCredentials"] = () => ({
    status: { jira: { complete: true }, xray: { complete: true } },
  });
  net.routes["jobs.list"] = () => [];
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("touches", () => {
  it("keeps the paths under a prefix or equal to it; an empty prefix keeps all", () => {
    const paths = ["docs/D1/doc.md", "docs/D10/doc.md", "project.json", "tests/t1/test.md"];
    expect(touches(paths, ["docs/D1/"])).toEqual(["docs/D1/doc.md"]);
    expect(touches(paths, ["project.json", "tests/"])).toEqual(["project.json", "tests/t1/test.md"]);
    expect(touches(paths, [""])).toEqual(paths);
    expect(touches(paths, [])).toEqual([]);
  });
});

function Probe({ prefixes, onHit }: { prefixes: string[]; onHit: (p: string[]) => void }) {
  useChanged(prefixes, onHit);
  return null;
}

describe("useChanged", () => {
  it("calls back with the matching paths of a changed event only, and follows new prefixes", async () => {
    const onHit = vi.fn();
    const { rerender } = render(<Probe prefixes={["docs/D1/"]} onHit={onHit} />);
    await waitFor(() => expect(FakeES.all.size).toBe(1));
    act(() =>
      FakeES.emit({
        jobId: "j",
        at: "",
        type: "status",
        job: { id: "j", kind: "claude", subject: "", status: "done", startedAt: "" },
      } satisfies JobEvent),
    );
    changed(["tests/t1/test.md"]);
    expect(onHit).not.toHaveBeenCalled();
    changed(["docs/D1/doc.md", "docs/D2/doc.md"]);
    expect(onHit).toHaveBeenLastCalledWith(["docs/D1/doc.md"]);
    rerender(<Probe prefixes={["docs/D2/"]} onHit={onHit} />);
    changed(["docs/D1/doc.md"]);
    expect(onHit).toHaveBeenCalledTimes(1);
    changed(["docs/D2/figures/f.png"]);
    expect(onHit).toHaveBeenLastCalledWith(["docs/D2/figures/f.png"]);
  });
});
