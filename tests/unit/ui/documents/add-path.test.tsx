// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddPath } from "../../../../src/ui/screens/documents/AddPath.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

afterEach(() => {
  cleanup();
  noDesktop();
});

describe("Add a document from a path", () => {
  it("drops the quotes of « Copy as path », adds the path and closes", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<AddPath onAdd={onAdd} onClose={onClose} />);
    const field = screen.getByRole("textbox", { name: "Path of the file" });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(field, { target: { value: '  "C:\\Specs\\SOSIE_211.docx" ' } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("C:\\Specs\\SOSIE_211.docx");
    expect(onClose).toHaveBeenCalled();
  });

  it("adds nothing when Enter is pressed on an empty path", () => {
    const onAdd = vi.fn();
    render(<AddPath onAdd={onAdd} onClose={() => {}} />);
    fireEvent.submit(screen.getByRole("textbox", { name: "Path of the file" }).closest("form") as HTMLFormElement);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("offers Browse… only in the desktop app, which fills the path with the picked file", async () => {
    render(<AddPath onAdd={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Browse…" })).toBeNull();
    cleanup();
    const d = fakeDesktop({ files: ["D:\\Docs\\D401.pdf"] });
    render(<AddPath onAdd={() => {}} onClose={() => {}} />);
    expect(screen.getAllByRole("button", { name: "Browse…" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Browse…" })[0]);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Path of the file" })).toHaveValue("D:\\Docs\\D401.pdf"),
    );
    expect(d.pickFiles).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "Word or PDF", extensions: ["docx", "pdf"] }], multiple: false }),
    );
  });

  it("keeps the path when the picker is closed without a file", async () => {
    const d = fakeDesktop({ files: [] });
    render(<AddPath onAdd={() => {}} onClose={() => {}} />);
    const field = screen.getByRole("textbox", { name: "Path of the file" });
    fireEvent.change(field, { target: { value: "C:\\a.docx" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Browse…" })[0]);
    await waitFor(() => expect(d.pickFiles).toHaveBeenCalled());
    expect(field).toHaveValue("C:\\a.docx");
  });

  it("says how to paste a path, takes the PDF rendering of the same name, and refuses another name", () => {
    const onAdd = vi.fn();
    render(<AddPath onAdd={onAdd} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Add a document from a path" })).toHaveTextContent(
      /Paste it from (Explorer|the Finder)/,
    );
    const pdf = screen.getByRole("textbox", { name: "Its PDF rendering (optional)" });
    fireEvent.change(screen.getByRole("textbox", { name: "Path of the file" }), {
      target: { value: "C:\\Specs\\D401.docx" },
    });
    fireEvent.change(pdf, { target: { value: "C:\\Specs\\other.pdf" } });
    expect(screen.getByText("Name it like the .docx: D401.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(pdf, { target: { value: "C:\\Specs\\D401.txt" } });
    expect(screen.getByText("A PDF rendering ends in .pdf")).toBeInTheDocument();
    fireEvent.change(pdf, { target: { value: '"D:\\Print\\d401.PDF"' } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("C:\\Specs\\D401.docx", "D:\\Print\\d401.PDF");
  });

  it("a .pdf has no PDF rendering", () => {
    render(<AddPath onAdd={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Path of the file" }), { target: { value: "C:\\a.pdf" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Its PDF rendering (optional)" }), {
      target: { value: "C:\\a.pdf" },
    });
    expect(screen.getByText("Only a .docx has a PDF rendering")).toBeInTheDocument();
  });
});
