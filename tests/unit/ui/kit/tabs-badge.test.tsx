// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Badge,
  type BadgeTone,
  DIFF,
  REVIEW,
  ReviewBadge,
  SEVERITY,
  SeverityBadge,
  SYNC,
} from "../../../../src/ui/components/ui/Badge.tsx";
import { TabPanel, Tabs, type TabsProps } from "../../../../src/ui/components/ui/Tabs.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";

type V = "local" | "jira" | "off" | "later";
const TABS: TabsProps<V>["tabs"] = [
  { value: "local", label: "Local", count: 12, icon: "file" },
  { value: "jira", label: "Jira", count: 3 },
  { value: "off", label: "Off", disabled: true },
  { value: "later", label: "Later", disabled: "Connect Jira first" },
];

function Controlled(p: Partial<TabsProps<V>>) {
  const [v, setV] = useState<V>("local");
  return (
    <>
      <Tabs label="Test list" value={v} tabs={TABS} onChange={setV} panelId="tl" {...p} />
      <TabPanel panelId="tl" value={v}>
        Panel {v}
      </TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("is a tablist of tabs, the open one selected and controlling its panel", () => {
    render(<Controlled />);
    const list = screen.getByRole("tablist", { name: "Test list" });
    const [local, jira] = within(list).getAllByRole("tab");
    expect(local).toHaveAttribute("aria-selected", "true");
    expect(local).toHaveTextContent("Local12");
    expect(local.querySelector("svg")).not.toBeNull();
    expect(jira).toHaveAttribute("aria-selected", "false");
    expect(local).toHaveAttribute("aria-controls", "tl-local");
    expect(screen.getByRole("tabpanel", { name: /Local/ })).toHaveTextContent("Panel local");
  });

  it("opens a tab on click, and the arrows, Home and End move and open, skipping disabled tabs", () => {
    render(<Controlled />);
    const [local, jira, off, later] = screen.getAllByRole("tab");
    expect(local).toHaveAttribute("tabindex", "0");
    expect(jira).toHaveAttribute("tabindex", "-1");
    fireEvent.click(jira);
    expect(jira).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel jira");
    act(() => jira.focus());
    fireEvent.keyDown(jira, { key: "ArrowRight" });
    expect(local).toHaveAttribute("aria-selected", "true");
    expect(local).toHaveFocus();
    fireEvent.keyDown(local, { key: "ArrowLeft" });
    expect(jira).toHaveFocus();
    fireEvent.keyDown(jira, { key: "Home" });
    expect(local).toHaveFocus();
    fireEvent.keyDown(local, { key: "End" });
    expect(jira).toHaveFocus();
    fireEvent.keyDown(jira, { key: "x" });
    expect(jira).toHaveFocus();
    fireEvent.click(off);
    fireEvent.click(later);
    expect(jira).toHaveAttribute("aria-selected", "true");
    expect(off).toHaveAttribute("aria-disabled", "true");
    expect(later).toHaveAccessibleDescription("Connect Jira first");
  });

  it("has sizes, fill and catalogue states", () => {
    const one = (p: Partial<TabsProps<V>>, label: string) => {
      render(<Tabs label={label} value="local" tabs={TABS.slice(0, 2)} onChange={() => {}} {...p} />);
      return within(screen.getByRole("tablist", { name: label }));
    };
    const md = one({}, "md");
    const sm = one({ size: "sm" }, "sm");
    const fill = one({ fill: true }, "fill");
    const hover = one({ debugState: { value: "jira", state: "hover" } }, "hover");
    const focus = one({ debugState: { value: "jira", state: "focus" } }, "focus");
    const jiras = [md, sm, fill, hover, focus].map((w) => cls(w.getByRole("tab", { name: /Jira/ })));
    expect(new Set(jiras).size).toBe(5);
    expect(screen.getByRole("tablist", { name: "sm" })).not.toHaveAttribute(
      "class",
      cls(screen.getByRole("tablist", { name: "md" })),
    );
  });

  it("as steps, is an ordered list whose current step is marked, the earlier ones done, each one a button", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        variant="steps"
        label="Setup steps"
        value="project"
        tabs={[
          { value: "access", label: "Access" },
          { value: "project", label: "Project" },
          { value: "pack", label: "Search pack" },
          { value: "never", label: "Never", disabled: true },
        ]}
        onChange={onChange}
        debugState={{ value: "pack", state: "focus" }}
      />,
    );
    const list = screen.getByRole("list", { name: "Setup steps" });
    const items = within(list).getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(within(items[0]).getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(items[2]).toHaveTextContent("3Search pack");
    fireEvent.click(within(items[0]).getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("access");
    expect(within(items[3]).getByRole("button")).toBeDisabled();
  });
});

describe("Badge", () => {
  it("shows an icon and a word, coloured by its tone", () => {
    const tones: BadgeTone[] = ["neutral", "info", "success", "warning", "danger", "claude", "accent"];
    for (const t of tones) render(<Badge label={`tone ${t}`} tone={t} icon="info" />);
    const looks = new Set(tones.map((t) => cls(screen.getByText(`tone ${t}`))));
    expect(looks.size).toBe(tones.length);
    expect(screen.getByText("tone info").querySelector("svg")).not.toBeNull();
  });

  it("has outline, sm, count, sm count and an icon-less look", () => {
    render(
      <>
        <Badge label="plain" />
        <Badge label="iconed" icon="info" />
        <Badge label="outline" icon="info" outline />
        <Badge label="small" icon="info" size="sm" />
        <Badge label="12" count />
        <Badge label="3" count size="sm" />
      </>,
    );
    const looks = new Set(["plain", "iconed", "outline", "small", "12", "3"].map((n) => cls(screen.getByText(n))));
    expect(looks.size).toBe(6);
  });

  it("as a dot is an image named by its label", () => {
    render(<Badge label="All good" dot tone="success" />);
    const dot = screen.getByRole("img", { name: "All good" });
    expect(dot).toBeEmptyDOMElement();
  });

  it("busy, a spinner replaces the icon", () => {
    render(<Badge label="Indexing…" icon="info" busy tone="info" />);
    const b = screen.getByText("Indexing…");
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b.querySelector("svg")).toBeNull();
    expect(b.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("with a tooltip, says more on hover", () => {
    vi.useFakeTimers();
    render(<Badge label="Jira version" tooltip="The version last pulled from Jira" outline />);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).toHaveTextContent("The version last pulled from Jira");
    expect(screen.getByText("Jira version")).toHaveAttribute("aria-describedby", tip.id);
  });

  it("speaks the fixed vocabularies: review, severity, sync and diff", () => {
    render(
      <>
        {(["draft", "to-fix", "validated"] as const).map((s) => (
          <ReviewBadge key={s} state={s} />
        ))}
        {(["error", "warning", "info"] as const).map((s) => (
          <SeverityBadge key={s} severity={s} size="sm" />
        ))}
      </>,
    );
    for (const w of [...Object.values(REVIEW), ...Object.values(SEVERITY)]) {
      const el = screen.getByText(w.label);
      expect(el.querySelector("svg")).not.toBeNull();
    }
    expect(Object.values(SYNC).map((w) => w.label)).toEqual([
      "Checking…",
      "In sync",
      "Modified",
      "Changed in Jira",
      "Conflict",
      "Local only",
    ]);
    expect(Object.values(DIFF).map((w) => w.label)).toEqual(["New", "Modified", "Deleted", "Changed by Claude"]);
    expect(REVIEW["to-fix"].tone).toBe("warning");
    expect(SEVERITY.error.tone).toBe("danger");
  });
});
