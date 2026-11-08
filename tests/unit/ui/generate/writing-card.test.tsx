// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WritingCard } from "../../../../src/ui/screens/generate/WritingCard.tsx";
import { api } from "../../helpers/ui-desktop.tsx";
import { test } from "./fixtures.ts";
import { freshPage, mountData } from "./harness.tsx";

beforeEach(freshPage);
afterEach(cleanup);

const gone = () => Object.assign(new Error("No test local-aaaaaaaa in this project."), { code: "test-gone" });

describe("a test of the running generation", () => {
  it("shows what Claude saved so far", async () => {
    api.routes["tests.show"] = () => ({ test: test("Premier test"), check: null });
    mountData(<WritingCard entry={{ id: "local-aaaaaaaa", state: "written" }} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Step 1")).toBeInTheDocument();
  });

  it("deleted while the generation runs, says so instead of loading for ever", async () => {
    api.routes["tests.show"] = () => {
      throw gone();
    };
    mountData(
      <WritingCard
        entry={{ id: "local-aaaaaaaa", summary: "Le test prévu", state: "written" }}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByText("This test was deleted.")).toBeInTheDocument();
    expect(screen.getByText("Deleted since Claude wrote it")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^Le test prévu/ })).toBeInTheDocument();
  });
});
