// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Review, SyncState } from "../../src/core/types.ts";
import { ClaudeBadge } from "../../src/ui/components/legacy/ClaudeBadge.tsx";
import { ReviewBadge } from "../../src/ui/components/legacy/ReviewBadge.tsx";
import { Severity } from "../../src/ui/components/legacy/Severity.tsx";
import { SyncBadge } from "../../src/ui/components/legacy/SyncBadge.tsx";

afterEach(cleanup);

describe("state badges pair an icon with a word", () => {
  const reviews: [Review, string, string][] = [
    ["draft", "Draft", "b-neutral"],
    ["to-fix", "To fix", "b-warn"],
  ];
  it.each(reviews)("review %s", (review, word, tone) => {
    const { container } = render(<ReviewBadge review={review} />);
    const badge = container.querySelector(".badge");
    expect(badge).toHaveTextContent(word);
    expect(badge).toHaveClass(tone);
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it.each(["checked", "validated"] as Review[])("review %s says nothing", (review) => {
    const { container } = render(<ReviewBadge review={review} />);
    expect(container.querySelector(".badge")).toBeNull();
  });

  const syncs: [SyncState, string][] = [
    ["local", "Local only"],
    ["modified", "Modified"],
    ["synced", "Up to date"],
    ["remote-changed", "Changed in Jira"],
  ];
  it.each(syncs)("sync %s", (sync, word) => {
    const { container } = render(<SyncBadge sync={sync} />);
    const badge = container.querySelector(".badge");
    expect(badge).toHaveTextContent(word);
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("only Changed in Jira is amber among the sync badges", () => {
    const { container } = render(
      <>
        <SyncBadge sync="local" />
        <SyncBadge sync="remote-changed" />
      </>,
    );
    const [local, changed] = Array.from(container.querySelectorAll(".badge"));
    expect(local).toHaveClass("b-line");
    expect(changed).toHaveClass("b-warn");
  });

  it("Claude and severity markers carry a word too", () => {
    const { container } = render(
      <>
        <ClaudeBadge />
        <Severity tone="error" />
        <Severity tone="ok" />
      </>,
    );
    expect(container).toHaveTextContent("Changed by Claude");
    expect(container).toHaveTextContent("Error");
    expect(container).toHaveTextContent("No findings");
    expect(container.querySelectorAll("svg")).toHaveLength(3);
  });
});
