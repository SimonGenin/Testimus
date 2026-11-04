// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chip } from "../../../../src/ui/components/ui/Chip.tsx";
import { Select } from "../../../../src/ui/components/ui/Select.tsx";
import { type SaveState, Text } from "../../../../src/ui/components/ui/Text.tsx";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { ApiError } from "../../../../src/ui/lib/data/client.ts";
import { createQueryClient, type Key } from "../../../../src/ui/lib/data/query.ts";

const client = createQueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
let n = 0;
const k = (): Key => ["/p", "project.notes", { n: ++n }];
const cls = (el: Element | null) => el?.getAttribute("class") ?? "";
const box = (el: HTMLElement) => el.parentElement as HTMLElement;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  clearDrafts();
  vi.useRealTimers();
});

function Plain(props: { multiline?: boolean }) {
  const [v, setV] = useState("");
  return <Text label="Name" value={v} onChange={setV} multiline={props.multiline} />;
}

describe("Text", () => {
  it("is a labelled text field, single line or growing", () => {
    render(<Plain />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "Sectionneur" } });
    expect(input).toHaveValue("Sectionneur");
    cleanup();
    render(<Plain multiline />);
    expect(screen.getByRole("textbox", { name: "Name" }).tagName).toBe("TEXTAREA");
  });

  it("without a visible label takes its accessible name, and says its hint and its error", () => {
    render(
      <Text
        ariaLabel="Path"
        value=""
        placeholder="C:/claude.exe"
        hint="An absolute path"
        error="Use an absolute path"
        icon="folder"
        trailing={<span>…</span>}
      />,
    );
    const f = screen.getByRole("textbox", { name: "Path" });
    expect(f).toHaveAttribute("placeholder", "C:/claude.exe");
    expect(f).toBeInvalid();
    expect(f).toHaveAccessibleDescription("An absolute path Use an absolute path");
  });

  it("has a look for each appearance, size, the title and each state", () => {
    const looks = new Set<string>();
    const cases: Record<string, Parameters<typeof Text>[0]> = {
      boxed: { ariaLabel: "boxed", value: "" },
      inline: { ariaLabel: "inline", value: "", appearance: "inline" },
      bare: { ariaLabel: "bare", value: "", appearance: "bare" },
      sm: { ariaLabel: "sm", value: "", size: "sm" },
      title: { ariaLabel: "title", value: "", title: true },
      disabled: { ariaLabel: "disabled", value: "", disabled: true },
      readOnly: { ariaLabel: "readOnly", value: "", readOnly: true },
      claude: { ariaLabel: "claude", value: "", lockedBy: "claude" },
      hover: { ariaLabel: "hover", value: "", debugState: "hover" },
      focus: { ariaLabel: "focus", value: "", debugState: "focus" },
    };
    for (const p of Object.values(cases)) {
      render(<Text {...p} />);
      looks.add(cls(box(screen.getByRole("textbox", { name: p.ariaLabel }))));
    }
    expect(looks.size).toBe(Object.keys(cases).length);
    expect(screen.getByRole("textbox", { name: "disabled" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "readOnly" })).toHaveAttribute("readonly");
  });

  it("is read-only while Claude edits the file, and says so", () => {
    render(<Text ariaLabel="Action" value="x" lockedBy="claude" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Action" })).toHaveAttribute("readonly");
    expect(screen.getByText("Read-only — Claude is editing")).toBeInTheDocument();
  });

  it("saves itself 400 ms after the last key and on blur, then says Saved", async () => {
    const save = vi.fn(async () => "2");
    render(<Text label="Notes" value="disk" base="1" save={save} saveKey={k()} multiline />, { wrapper });
    const f = screen.getByRole("textbox", { name: /Notes/ });
    fireEvent.change(f, { target: { value: "disk!" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).toHaveBeenCalledWith("disk!", "1");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Notes" })).toBe(f);
    fireEvent.change(f, { target: { value: "disk!!" } });
    expect(screen.queryByText("Edited")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).toHaveBeenCalledTimes(2);
    fireEvent.change(f, { target: { value: "on blur" } });
    fireEvent.blur(f);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(save).toHaveBeenLastCalledWith("on blur", "2");
  });

  it("says Edited once a pending edit waits for more than a second (save on blur)", async () => {
    render(<Text label="Notes" value="" save={vi.fn(async () => undefined)} saveKey={k()} delay="blur" />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: /Notes/ }), { target: { value: "a" } });
    expect(screen.queryByText("Edited")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("keeps the text when a save fails and Retry sends it again", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError("disk full")).mockResolvedValue("3");
    render(<Text ariaLabel="Notes" value="" save={save} saveKey={k()} />, { wrapper });
    const f = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.change(f, { target: { value: "kept" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved");
    expect(f).toHaveValue("kept");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("on a conflict with the disk, offers Reload from disk and Keep mine", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("moved", undefined, 409, "conflict"))
      .mockResolvedValue("9");
    render(<Text ariaLabel="Notes" value="disk" base="1" save={save} saveKey={k()} />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "mine" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(screen.getAllByText("Changed on disk").length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep mine" })));
    expect(save).toHaveBeenLastCalledWith("mine", undefined);
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();

    const save2 = vi.fn().mockRejectedValue(new ApiError("moved", undefined, 409, "conflict"));
    render(<Text ariaLabel="Other" value="theirs" save={save2} saveKey={k()} />, { wrapper });
    const other = screen.getByRole("textbox", { name: "Other" });
    fireEvent.change(other, { target: { value: "lost" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Reload from disk" })));
    expect(other).toHaveValue("theirs");
  });

  it("bound to a document's autosave, shows its state and flushes it on blur", () => {
    const a: SaveState = {
      status: "saving",
      flush: vi.fn(async () => {}),
      retry: vi.fn(async () => {}),
      keepMine: vi.fn(async () => {}),
      takeDisk: vi.fn(),
    };
    const onChange = vi.fn();
    render(
      <Text ariaLabel="Expected Result" value="ok" onChange={onChange} autosave={a} appearance="inline" multiline />,
    );
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    const f = screen.getByRole("textbox", { name: "Expected Result" });
    fireEvent.change(f, { target: { value: "ok!" } });
    expect(onChange).toHaveBeenCalledWith("ok!");
    fireEvent.blur(f);
    expect(a.flush).toHaveBeenCalled();
  });

  it("keeps a plain field's draft for when the screen comes back", () => {
    const key = k();
    const { unmount } = render(<Text ariaLabel="Request" value="" draftKey={key} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Request" }), { target: { value: "draft" } });
    unmount();
    render(<Text ariaLabel="Request" value="" draftKey={key} />);
    expect(screen.getByRole("textbox", { name: "Request" })).toHaveValue("draft");
  });

  it("passes its keys, focus and ref, and a type", () => {
    const onKeyDown = vi.fn();
    const onFocus = vi.fn();
    const ref = createRef<HTMLInputElement | HTMLTextAreaElement>();
    render(
      <Text
        ariaLabel="Token"
        value=""
        type="password"
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        inputRef={ref}
        name="t"
      />,
    );
    const f = screen.getByLabelText("Token");
    fireEvent.keyDown(f, { key: "Enter" });
    fireEvent.focus(f);
    expect(onKeyDown).toHaveBeenCalled();
    expect(onFocus).toHaveBeenCalled();
    expect(ref.current).toBe(f);
    expect(f).toHaveAttribute("type", "password");
  });

  it("a growing field fits its text again when its width changes, not when only its height does", () => {
    const watched: { cb: ResizeObserverCallback; el?: Element; off: boolean }[] = [];
    class FakeRO {
      w: (typeof watched)[number];
      constructor(cb: ResizeObserverCallback) {
        this.w = { cb, off: false };
        watched.push(this.w);
      }
      observe(el: Element) {
        this.w.el = el;
      }
      disconnect() {
        this.w.off = true;
      }
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    const { unmount } = render(<Text ariaLabel="Expected" multiline value="Le poste affiche un long message" />);
    const area = screen.getByRole("textbox", { name: "Expected" }) as HTMLTextAreaElement;
    let tall = 48;
    Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => tall });
    const w = watched.find((x) => x.el === area);
    expect(w).toBeDefined();
    const resize = (width: number) =>
      act(() =>
        w?.cb([{ target: area, contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver),
      );
    resize(200);
    expect(area.style.height).toBe("48px");
    tall = 96;
    resize(200);
    expect(area.style.height).toBe("48px");
    resize(120);
    expect(area.style.height).toBe("96px");
    unmount();
    expect(w?.off).toBe(true);
    vi.unstubAllGlobals();
  });

  it("refuses to save without the read it saves", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Text ariaLabel="x" value="" save={vi.fn()} />)).toThrow(/saveKey/);
  });
});

describe("Chip", () => {
  it("a warning tone is tinted whether pressed or not, its icon too (the « Jira version » toggle)", () => {
    render(
      <>
        <Chip label="Jira version" tone="warning" icon="clock" pressed={false} onToggle={() => {}} />
        <Chip label="Plain" icon="clock" pressed={false} onToggle={() => {}} />
      </>,
    );
    const warn = screen.getByRole("button", { name: "Jira version" });
    const plain = screen.getByRole("button", { name: "Plain" });
    expect(warn).toHaveAttribute("aria-pressed", "false");
    expect(warn.className).not.toBe(plain.className);
    expect(warn.querySelector("span")?.className).not.toBe(plain.querySelector("span")?.className);
  });

  it("as a toggle is a pressed button; off it can be struck through", () => {
    const onToggle = vi.fn();
    render(<Chip label="Glossaire" pressed onToggle={onToggle} tone="claude" icon="context" />);
    const c = screen.getByRole("button", { name: "Glossaire" });
    expect(c).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(c);
    expect(onToggle).toHaveBeenCalled();
    render(<Chip label="Off" pressed={false} onToggle={() => {}} strikeOff />);
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
  });

  it("as a value in a set has a remove button; mono, square, disabled and hover have their look", () => {
    const onRemove = vi.fn();
    render(<Chip label="LFRPS12-7" mono square onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove LFRPS12-7" }));
    expect(onRemove).toHaveBeenCalled();
    const looks = new Set<string>();
    for (const [name, p] of [
      ["plain", {}],
      ["mono", { mono: true }],
      ["square", { square: true }],
      ["disabled", { disabled: true }],
      ["hover", { debugState: "hover" as const }],
    ] as const) {
      render(<Chip label={name} {...p} />);
      looks.add(cls(screen.getByText(name).parentElement));
    }
    expect(looks.size).toBe(5);
  });
});

describe("Select", () => {
  const options = [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku", disabled: true },
  ];

  it("is a combobox named by its label that picks one value", () => {
    const onChange = vi.fn();
    render(<Select label="Model" value="opus" options={options} onChange={onChange} />);
    const s = screen.getByRole("combobox", { name: "Model" });
    fireEvent.change(s, { target: { value: "sonnet" } });
    expect(onChange).toHaveBeenCalledWith("sonnet");
    expect(screen.getByRole("option", { name: "Haiku" })).toBeDisabled();
  });

  it("shows a placeholder while nothing is chosen, a visible label, a prefix, an icon, quiet and small looks", () => {
    render(
      <Select
        label="Folder"
        showLabel
        value={null}
        placeholder="Choose a folder…"
        options={options}
        onChange={() => {}}
        block
      />,
    );
    expect(screen.getByRole("combobox", { name: "Folder" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose a folder…" })).toBeInTheDocument();
    const looks = new Set<string>();
    for (const [name, p] of [
      ["boxed", {}],
      ["quiet", { appearance: "quiet" as const }],
      ["small", { size: "sm" as const }],
      ["icon", { icon: "sort" as const }],
      ["prefix", { prefix: "Sort" }],
      ["hover", { debugState: "hover" as const }],
      ["focus", { debugState: "focus" as const }],
    ] as const) {
      render(<Select label={name} value="opus" options={options} onChange={() => {}} {...p} />);
      looks.add(cls(screen.getByRole("combobox", { name })));
    }
    expect(looks.size).toBe(7);
  });

  it("disabled with a reason, says why", () => {
    render(<Select label="Effort" value="opus" options={options} onChange={() => {}} disabled="Claude is working" />);
    const s = screen.getByRole("combobox", { name: "Effort" });
    expect(s).toBeDisabled();
    expect(s.parentElement).toHaveAccessibleDescription("Claude is working");
  });
});

describe("model options asked by the kit lots", () => {
  it("Text puts leading content before the value, and drives a list as a combobox", () => {
    render(
      <Text
        ariaLabel="Labels"
        value=""
        leading={<span>chip-a</span>}
        combobox={{ expanded: true, controls: "list-1", activeDescendant: "opt-2", autocomplete: "list" }}
        onChange={() => {}}
      />,
    );
    const f = screen.getByRole("combobox", { name: "Labels" });
    expect(f).toHaveAttribute("aria-expanded", "true");
    expect(f).toHaveAttribute("aria-controls", "list-1");
    expect(f).toHaveAttribute("aria-activedescendant", "opt-2");
    expect(f).toHaveAttribute("aria-autocomplete", "list");
    expect(f.previousElementSibling).toHaveTextContent("chip-a");
  });

  it("Chip sits in a field, can be pressed without being a toggle, and shows a dot", () => {
    const onClick = vi.fn();
    render(<Chip label="Data" onClick={onClick} dot />);
    const c = screen.getByRole("button", { name: /Data/ });
    expect(c).not.toHaveAttribute("aria-pressed");
    expect(c).toHaveTextContent("●");
    fireEvent.click(c);
    expect(onClick).toHaveBeenCalled();
    render(<Chip label="in field" inField onRemove={() => {}} />);
    render(<Chip label="plain one" onRemove={() => {}} />);
    expect(cls(screen.getByText("in field").parentElement)).not.toBe(cls(screen.getByText("plain one").parentElement));
  });
});
