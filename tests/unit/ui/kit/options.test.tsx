// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Badge,
  COLUMN,
  DIFF,
  DOC_STATUS,
  HEALTH,
  jiraStatus,
  REVIEW,
  SEVERITY,
  SYNC,
} from "../../../../src/ui/components/ui/Badge.tsx";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { Card } from "../../../../src/ui/components/ui/Card.tsx";
import { Select } from "../../../../src/ui/components/ui/Select.tsx";
import { Skeleton } from "../../../../src/ui/components/ui/Skeleton.tsx";
import { Tooltip } from "../../../../src/ui/components/ui/Tooltip.tsx";
import { files, read } from "../../guards/scan.ts";

afterEach(cleanup);

const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

describe("Card options (audit n° 21, 22, 24, 42, 51)", () => {
  it("onOpen: the whole card is one button that opens, named by its content", () => {
    const open = vi.fn();
    render(
      <Card title="Figure 3" onOpen={open}>
        Synoptique
      </Card>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Figure 3\s*Synoptique/ }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("dashed, focused and each edge are looks of their own", () => {
    render(
      <>
        <Card title="plain">x</Card>
        <Card title="dashed" dashed>
          x
        </Card>
        <Card title="focused" focused>
          x
        </Card>
        {(["warning", "success", "claude", "danger"] as const).map((e) => (
          <Card key={e} title={e} edge={e}>
            x
          </Card>
        ))}
      </>,
    );
    const looks = ["plain", "dashed", "focused", "warning", "success", "claude", "danger"].map((n) =>
      cls(screen.getByRole("region", { name: n })),
    );
    expect(new Set(looks).size).toBe(looks.length);
  });
});

describe("Select (audit n° 50, 52)", () => {
  const options = [
    { value: "haiku", label: "Haiku", hint: "Fast." },
    { value: "opus", label: "Opus", hint: "Thorough." },
  ];

  it("an option's hint is its tooltip, and the chosen one's shows under a labelled select", () => {
    render(<Select label="Model" showLabel value="opus" options={options} onChange={() => {}} />);
    const field = screen.getByRole("combobox", { name: "Model" });
    expect(field).toHaveAccessibleDescription("Thorough.");
    expect(screen.getByRole("option", { name: "Haiku" })).toHaveAttribute("title", "Fast.");
  });

  it("its shown label is the Field's, the same as a Text's", () => {
    render(<Select label="Model" showLabel value="opus" options={options} onChange={() => {}} />);
    const label = screen.getByText("Model", { selector: "label" });
    expect(label.parentElement?.getAttribute("class")).toContain("type.label");
  });
});

describe("Badge vocabularies (audit n° 30, 31, 32, 33)", () => {
  it("a word of REVIEW, SEVERITY and DIFF takes its own colour alias, not only its tone", () => {
    for (const word of [...Object.values(REVIEW), ...Object.values(SEVERITY), ...Object.values(DIFF)])
      expect(word.ink, word.label).toBeTruthy();
    expect(SYNC.modified.ink).toBe("diffModified");
    render(
      <>
        <Badge label="tone" tone="warning" icon="to-fix" />
        <Badge {...REVIEW["to-fix"]} />
      </>,
    );
    expect(cls(screen.getByText("To fix"))).not.toBe(cls(screen.getByText("tone")));
  });

  it("the app's other vocabularies live with Badge: columns, document status, health, Jira status", () => {
    expect(COLUMN.local).toBe(SYNC.local);
    expect(DOC_STATUS.validated.label).toBe("Validated");
    expect(HEALTH.fail).toMatchObject({ label: "Failed", tone: "danger", icon: "x-circle" });
    expect(jiraStatus("Done")).toMatchObject({ label: "Done", tone: "success", icon: "check-circle" });
    expect(jiraStatus("In Progress")).toMatchObject({ tone: "warning", icon: "clock" });
    expect(jiraStatus("To Do")).toMatchObject({ tone: "neutral", icon: "circle-dashed" });
  });
});

describe("Button field (audit n° 12)", () => {
  it("is a pill of its own look that keeps its shortcut", () => {
    render(
      <>
        <Button variant="field" icon="search" label="Search" shortcut="Ctrl K" />
        <Button variant="quiet" icon="search" label="Quiet" />
      </>,
    );
    const field = screen.getByRole("button", { name: /Search/ });
    expect(field).toHaveTextContent("Ctrl K");
    expect(cls(field)).not.toBe(cls(screen.getByRole("button", { name: "Quiet" })));
  });
});

describe("catalogue states (audit n° 53)", () => {
  it("Skeleton's late state says it is still loading and offers Retry", () => {
    const retry = vi.fn();
    render(<Skeleton onRetry={retry} debugState="late" />);
    expect(screen.getByRole("status")).toHaveTextContent("Still loading");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("a Tooltip can be shown open without the pointer", () => {
    render(
      <Tooltip label="Pull from Jira" side="right" debugState="open">
        <span>anchor</span>
      </Tooltip>,
    );
    expect(screen.getByRole("tooltip")).toBeVisible();
  });
});

describe("one focus halo (audit n° 47)", () => {
  it("the field halo is written once, in components/ui/halo.ts", () => {
    const found = files("src/ui")
      .filter((f) => f !== "src/ui/components/ui/halo.ts")
      .filter((f) => /focus\.halo/.test(read(f)));
    expect(found).toEqual([]);
  });
});
