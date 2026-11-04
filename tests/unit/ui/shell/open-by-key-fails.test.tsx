// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project, setProject } from "../../../../src/ui/api.ts";
import { OpenByKey } from "../../../../src/ui/components/shell/OpenByKey.tsx";
import { callsOf, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const dialog = () => screen.getByRole("dialog", { name: "Open a project by its Jira key" });

describe("Open a project by its Jira key", () => {
  it("Enter with no key typed opens nothing and keeps the dialog", () => {
    const onClose = vi.fn();
    withData(<OpenByKey onClose={onClose} />);
    expect(within(dialog()).getByRole("button", { name: "Open" })).toBeDisabled();
    const form = dialog().querySelector("form");
    if (!form) throw new Error("the dialog is a form");
    fireEvent.submit(form);
    expect(callsOf("project.openKey")).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("says why a key could not be opened, stays on the same project and keeps the dialog open", async () => {
    net.routes["project.openKey"] = (i) => {
      if (i.dryRun) return { dir: "D:\\Work\\BHPTCC", created: false, key: i.key };
      throw new Fail("the folder is read-only");
    };
    const onClose = vi.fn();
    withData(<OpenByKey onClose={onClose} />);
    fireEvent.change(within(dialog()).getByLabelText("Jira project key"), { target: { value: "bhptcc" } });
    expect(await within(dialog()).findByText(/Testimus opens/)).toHaveTextContent("Testimus opens D:\\Work\\BHPTCC.");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Could not open BHPTCC")).toBeInTheDocument();
    expect(screen.getByText("the folder is read-only")).toBeInTheDocument();
    expect(project()).toBe("C:\\p");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Open" })).toBeEnabled());
  });
});
