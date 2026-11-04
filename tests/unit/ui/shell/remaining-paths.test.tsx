// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, setProject } from "../../../../src/ui/api.ts";
import { CommandForm } from "../../../../src/ui/components/shell/CommandForm.tsx";
import { ProjectButton } from "../../../../src/ui/components/shell/ProjectButton.tsx";
import { baseName } from "../../../../src/ui/lib/desktop.ts";
import { useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { withData } from "./helpers.tsx";

function Stores() {
  const t = useToasts();
  return <p>{t.length}</p>;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("small remaining paths", () => {
  it("sends {} for a null input", async () => {
    net.routes["a.b"] = (i) => i;
    expect(await call("a.b", null)).toEqual({});
  });

  it("keeps a path with no name part as it is", () => {
    expect(baseName("\\\\")).toBe("\\\\");
    expect(baseName("")).toBe("");
  });

  it("serves the stores' snapshots on the server too", () => {
    expect(renderToString(<Stores />)).toBe("<p>0</p>");
  });
});

describe("shell remaining paths", () => {
  it("shows an error instead of failing on a command without an input schema", async () => {
    withData(
      <CommandForm
        command={{ name: "a.b", summary: "s", mutates: false, job: false, input: undefined as never }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(callsOf("a.b")).toHaveLength(0);
  });

  it("accepts a project list it does not understand", async () => {
    net.routes["project.list"] = () => null;
    withData(<ProjectButton />);
    await waitFor(() => expect(callsOf("project.list")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /change project/ }));
    expect(screen.getByRole("menuitem", { name: "No other project known yet" })).toBeInTheDocument();
  });
});
