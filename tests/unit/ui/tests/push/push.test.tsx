// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, PushPlanView } from "../../../../../src/core/types.ts";
import { ApiError } from "../../../../../src/ui/api.ts";
import { PushDialog } from "../../../../../src/ui/screens/tests/PushDialog.tsx";
import { deferred } from "../../../helpers/ui-server.ts";
import { testClient, WithData } from "../data-helpers.tsx";

type Handler = (input: Record<string, unknown>, onEvent?: (e: JobEvent) => void) => unknown;
const h: { plan: Handler; push: Handler } = { plan: () => ({}), push: () => ({}) };
const pushes: Record<string, unknown>[] = [];

vi.mock("../../../../../src/ui/lib/data/client.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/data/client.ts")>();
  return {
    ...real,
    call: vi.fn(async (_name: string, input: Record<string, unknown>) => await h.plan(input)),
    run: vi.fn(async (_name: string, input: Record<string, unknown>, onEvent?: (e: JobEvent) => void) => {
      pushes.push(input);
      return await h.push(input, onEvent);
    }),
  };
});

const toasts: { title: string; detail?: string }[] = [];
vi.mock("../../../../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/toast.ts")>();
  return { ...real, toast: vi.fn((t: (typeof toasts)[number]) => toasts.push(t)) };
});

const plan = (o: Partial<PushPlanView> = {}): PushPlanView => ({
  testId: "t1",
  key: "LFRPS12-7",
  ops: [
    { kind: "update", label: "Update the summary" },
    { kind: "upload", label: "Upload a.png" },
    { kind: "other", label: "Tidy up" },
  ],
  warnings: [],
  remoteChanged: false,
  review: "validated",
  planHash: "h1",
  ...o,
});

const progress = (done?: number): JobEvent => ({ jobId: "j", at: "", type: "progress", message: "m", done });

beforeEach(() => {
  pushes.length = 0;
  toasts.length = 0;
  h.plan = () => plan();
  h.push = () => ({ ok: true, id: "LFRPS12-7", ops: [] });
});

afterEach(cleanup);

const dialog = (o: Partial<ComponentProps<typeof PushDialog>> = {}) => {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const r = render(
    <WithData client={testClient()}>
      <PushDialog testId="t1" testKey="LFRPS12-7" summary="Sectionneur" onDone={onDone} onClose={onClose} {...o} />
    </WithData>,
  );
  return { ...r, onDone, onClose };
};

const confirm = async () => {
  const b = await screen.findByRole("button", { name: "Confirm push" });
  await waitFor(() => expect(b).toBeEnabled());
  fireEvent.click(b);
};

describe("PushDialog › plan", () => {
  it("shows a loading plan, then the operations and the CLI equivalent", async () => {
    const gate = deferred<PushPlanView>();
    h.plan = () => gate.promise;
    dialog({ testKey: undefined });
    expect(screen.getByRole("status", { name: "Building the push plan" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Push this test to Jira?" })).toBeInTheDocument();
    expect(screen.getByText("testimus xray push t1")).toBeInTheDocument();
    gate.resolve(plan({ ops: [...plan().ops, { kind: "weird" as never, label: "Unknown kind" }] }));
    expect(await screen.findByText("What will happen · 4 operations")).toBeInTheDocument();
    expect(screen.getByText("Unknown kind")).toBeInTheDocument();
  });

  it("says when there is nothing to push", async () => {
    h.plan = () => plan({ ops: [] });
    dialog();
    expect(await screen.findByText("Nothing to push: Jira already has this version.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm push" })).toBeDisabled();
  });

  it("warns about a test that is not validated, hiding the plan's own validation warning", async () => {
    h.plan = () => plan({ review: "to-fix", warnings: ["Not validated yet", "Two images are large"] });
    dialog();
    expect(await screen.findByText("This test is To fix, not Validated")).toBeInTheDocument();
    expect(screen.queryByText("Not validated yet")).toBeNull();
    expect(screen.getByText("Two images are large")).toBeInTheDocument();
    cleanup();
    h.plan = () => plan({ review: "odd" as never });
    dialog();
    expect(await screen.findByText("This test is odd, not Validated")).toBeInTheDocument();
    cleanup();
    h.plan = () => plan({ warnings: ["Not validated yet"] });
    dialog({ review: "validated" });
    expect(await screen.findByText("Not validated yet")).toBeInTheDocument();
  });

  it("uses the review the editor passes over the plan's", async () => {
    dialog({ review: "draft" });
    expect(await screen.findByText("This test is Draft, not Validated")).toBeInTheDocument();
  });

  it("offers a comparison when Jira changed", async () => {
    h.plan = () => plan({ remoteChanged: true });
    const onCompare = vi.fn();
    dialog({ onCompare });
    fireEvent.click(await screen.findByRole("button", { name: "Compare with Jira" }));
    expect(onCompare).toHaveBeenCalled();
    expect(screen.getByText(/pushing replaces their change/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm push" })).toBeEnabled();
  });

  it("explains a plan that could not be built, with the fix when there is one", async () => {
    h.plan = () => {
      throw new ApiError("No Jira credentials", "Run testimus creds set");
    };
    const { onClose } = dialog();
    expect(await screen.findByText("Could not build the push plan")).toBeInTheDocument();
    expect(screen.getByText("No Jira credentials")).toBeInTheDocument();
    expect(screen.getByText("Run testimus creds set")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    h.plan = () => {
      throw new Error("offline");
    };
    dialog();
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(screen.queryByText("What to do")).toBeNull();
  });

  it("ignores a plan or an error that lands after it closed", async () => {
    const ok = deferred<PushPlanView>();
    h.plan = () => ok.promise;
    const a = dialog();
    a.unmount();
    ok.resolve(plan());
    const bad = deferred<PushPlanView>();
    h.plan = () => bad.promise;
    const b = dialog();
    b.unmount();
    bad.reject(new Error("late"));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("late")).toBeNull();
  });
});

describe("PushDialog › running", () => {
  it("shows each operation's state while it runs, then reports and closes", async () => {
    const gate = deferred<unknown>();
    let emit: (e: JobEvent) => void = () => {};
    h.push = (_input, on) => {
      emit = on ?? emit;
      return gate.promise;
    };
    const { onDone, onClose } = dialog();
    await confirm();
    const box = screen.getByRole("dialog", { name: "Pushing LFRPS12-7 to Jira" });
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.mouseDown(box.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Do not close Testimus until this is done")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    act(() => emit(progress(1)));
    act(() => emit(progress()));
    act(() => emit({ jobId: "j", at: "", type: "log", level: "info", message: "x" }));
    expect(screen.getByRole("progressbar", { name: "1 of 3 operations done" })).toBeInTheDocument();
    expect(screen.getByText(/1 done · 2 not started/)).toBeInTheDocument();
    await act(async () => {
      gate.resolve({ ok: true, id: "", ops: [] });
    });
    expect(onDone).toHaveBeenCalledWith("t1");
    expect(toasts.at(-1)).toEqual({ kind: "ok", title: "Pushed LFRPS12-7", detail: "3 operations" });
  });

  it("names the pushed test by its new id and counts the done operations", async () => {
    h.push = () => ({
      ok: true,
      id: "LFRPS12-99",
      ops: [
        { label: "a", status: "done" },
        { label: "b", status: "not-started" },
      ],
    });
    const { onDone } = dialog({ testKey: undefined });
    await confirm();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("LFRPS12-99"));
    expect(toasts.at(-1)).toMatchObject({ title: "Pushed LFRPS12-99", detail: "1 operation" });
  });

  it("says when Jira took the push but the local copy could not be refreshed", async () => {
    h.push = () => ({
      ok: true,
      id: "LFRPS12-99",
      ops: [{ label: "a", status: "done" }],
      error: "Pushed; refreshing from Jira failed — network down",
    });
    const { onDone } = dialog({ testKey: undefined });
    await confirm();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("LFRPS12-99"));
    expect(toasts.at(-1)).toMatchObject({
      kind: "error",
      title: "Pushed LFRPS12-99, but the local copy was not refreshed",
      detail: expect.stringContaining("Download from Jira"),
    });
  });

  it("falls back to a generic title and no operations", async () => {
    h.plan = () => plan({ ops: [{ kind: "create", label: "Create" }] });
    h.push = () => ({ ok: true, id: "", ops: [] });
    dialog({ testKey: undefined });
    await confirm();
    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ title: "Pushed the test", detail: "1 operation" }));
  });

  it("stops at a refused operation, shows Jira's reason and resumes from it", async () => {
    h.push = () => ({
      ok: false,
      id: "t1",
      failedAt: 1,
      ops: [
        { label: "Update the summary", status: "done" },
        { label: "Upload a.png", status: "failed", error: "413 Too large" },
        { label: "Tidy up", status: "not-started" },
      ],
      plan: { ...plan(), planHash: undefined },
    });
    const { onClose, onDone } = dialog();
    await confirm();
    expect(await screen.findByText("Push stopped at operation 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("413 Too large")).toBeInTheDocument();
    expect(screen.getByText(/Fix what Jira refused/)).toBeInTheDocument();
    expect(screen.getByText(/1 done · 1 failed · 1 not started/)).toBeInTheDocument();
    const resume = deferred<unknown>();
    h.push = () => resume.promise;
    fireEvent.click(screen.getByRole("button", { name: "Resume from operation 2" }));
    expect(pushes.at(-1)).toEqual({ id: "t1", from: 1, planHash: "h1" });
    expect(await screen.findByText(/resumed at 2/)).toBeInTheDocument();
    await act(async () => resume.resolve({ ok: true, id: "t1", ops: [] }));
    expect(onDone).toHaveBeenCalledWith("t1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes a new plan hash from a failed push and its error message", async () => {
    h.push = () => ({ ok: false, id: "t1", error: "Jira is read-only", ops: [], plan: plan({ planHash: "h2" }) });
    const { onClose } = dialog();
    await confirm();
    expect(await screen.findByText("Push stopped at operation 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Jira is read-only")).toBeInTheDocument();
    h.push = () => ({ ok: false, id: "t1", ops: [] });
    fireEvent.click(screen.getByRole("button", { name: "Resume from operation 1" }));
    expect(pushes.at(-1)).toEqual({ id: "t1", planHash: "h2" });
    expect(await screen.findByText("Jira refused an operation.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("marks the operation reached when the push throws, with the fix", async () => {
    h.push = (_i, on) => {
      on?.(progress(2));
      throw new ApiError("Rate limited", "Wait a minute");
    };
    dialog();
    await confirm();
    expect(await screen.findByText("Push stopped at operation 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.getByText("Wait a minute")).toBeInTheDocument();
    cleanup();
    h.push = () => {
      throw new Error("socket");
    };
    dialog();
    await confirm();
    expect(await screen.findByText("socket")).toBeInTheDocument();
  });

  it("shows an empty bar when a failed push comes back with an empty plan", async () => {
    h.push = () => ({ ok: false, id: "t1", ops: [], plan: plan({ ops: [] }) });
    dialog();
    await confirm();
    const bar = await screen.findByRole("progressbar", { name: "0 of 0 operations done" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("confirming a plan that shows a Jira change is the overwrite decision, as in Xray Editor", async () => {
    h.plan = () => plan({ remoteChanged: true });
    dialog();
    await screen.findByText("Changed in Jira since your pull");
    await confirm();
    await waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toEqual({ id: "t1", planHash: "h1", overwriteRemote: true });
  });
});
