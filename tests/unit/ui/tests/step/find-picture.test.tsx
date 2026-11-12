// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FindPicture } from "../../../../../src/ui/screens/tests/step/FindPicture.tsx";
import { fakeJob, fakeNet, info, inputs, mountSettings, net, reset } from "../../settings/helpers.tsx";

beforeEach(() => {
  fakeNet();
  net.routes["project.info"] = () => info();
});
afterEach(reset);

const PIC = {
  figure: "SOSIE_211_D401-1_3#fig:40",
  file: "docs/SOSIE_211_D401-1_3/figures/fig-40.png",
  field: "Action",
  why: "Le symbole du sectionneur sur la schématique.",
};

describe("a step's Find a picture", () => {
  it("asks nothing until clicked; then proposes the pictures found and adds the one picked", async () => {
    const j = fakeJob({ id: "find-image-c0000001", kind: "find-image" });
    net.routes["tests.findImage"] = () => ({ jobId: j.id });
    net.routes["tests.addImage"] = () => ({
      id: "LFRPS12-1420",
      step: 2,
      field: "Action",
      file: "images/x.png",
      from: "",
    });
    mountSettings(<FindPicture testId="LFRPS12-1420" step={2} />);
    expect(inputs("tests.findImage")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Find a picture" }));
    const dialog = await screen.findByRole("dialog", { name: "A picture for step 2" });
    expect(within(dialog).getByText(/Claude is looking for this step's screen/)).toBeInTheDocument();
    await waitFor(() => expect(inputs("tests.findImage")).toEqual([{ id: "LFRPS12-1420", step: 2 }]));
    await j.finish({ status: "done", result: { ok: true, runId: "r", summary: "", pictures: [PIC] } });
    expect(await within(dialog).findByText(PIC.why)).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: PIC.why })).toHaveAttribute(
      "src",
      expect.stringContaining("fig-40.png"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to step 2" }));
    await waitFor(() =>
      expect(inputs("tests.addImage")).toEqual([{ id: "LFRPS12-1420", step: 2, figure: PIC.figure, field: "Action" }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says when none shows the step, and why a search failed", async () => {
    const j = fakeJob({ id: "find-image-c0000002", kind: "find-image" });
    net.routes["tests.findImage"] = () => ({ jobId: j.id });
    mountSettings(<FindPicture testId="LFRPS12-1420" step={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Find a picture" }));
    await waitFor(() => expect(inputs("tests.findImage")).toHaveLength(1));
    await j.finish({ status: "done", result: { ok: true, runId: "r", summary: "", pictures: [] } });
    expect(await screen.findByText("No picture shows this step")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const k = fakeJob({ id: "find-image-c0000003", kind: "find-image" });
    net.routes["tests.findImage"] = () => ({ jobId: k.id });
    fireEvent.click(screen.getByRole("button", { name: "Find a picture" }));
    await waitFor(() => expect(inputs("tests.findImage")).toHaveLength(2));
    await k.finish({ status: "failed", error: "Claude Code is not signed in." });
    expect(await screen.findByText("Claude Code is not signed in.")).toBeInTheDocument();
  });
});
