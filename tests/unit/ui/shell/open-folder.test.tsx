// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project, setProject } from "../../../../src/ui/api.ts";
import { useOpenFolder } from "../../../../src/ui/app/useOpenFolder.ts";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { useApp } from "../../../../src/ui/lib/app.ts";
import { callsOf, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["project.list"] = () => [];
  net.routes["project.open"] = (i) => ({ dir: i.dir });
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
});

function Probe() {
  const open = useOpenFolder(useApp());
  return <Button label="Open a folder as a project…" onClick={() => void open()} />;
}

const click = () => fireEvent.click(screen.getByRole("button", { name: "Open a folder as a project…" }));

describe("the palette's « Open a folder as a project… »", () => {
  it("in the desktop shell: picks a folder and opens it; a cancelled picker opens nothing; a refused folder says so", async () => {
    const d = fakeDesktop({ folder: "D:\\Projets\\BHPTCC" });
    const { state } = withData(<Probe />);
    click();
    await waitFor(() => expect(callsOf("project.open")).toHaveLength(1));
    expect(callsOf("project.open")[0].input).toEqual({ dir: "D:\\Projets\\BHPTCC" });
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(project()).toBe("D:\\Projets\\BHPTCC");
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Projets\\BHPTCC");
    expect(d.pickFolder).toHaveBeenCalledWith({ title: "Open a project folder" });
    d.pickFolder.mockResolvedValueOnce(null);
    click();
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(callsOf("project.open")).toHaveLength(1);
    net.routes["project.open"] = () => {
      throw new Fail("not a project");
    };
    click();
    expect(await screen.findByText("Could not open the project")).toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("in a browser: goes to First launch › Project, which asks for the folder", () => {
    const { state } = withData(<Probe />);
    click();
    expect(state.navigate).toHaveBeenCalledWith("setup", "project/app");
    expect(callsOf("project.open")).toHaveLength(0);
  });
});
