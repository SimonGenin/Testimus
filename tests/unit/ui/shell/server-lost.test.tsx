// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerLost } from "../../../../src/ui/components/shell/ServerLost.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { isReachable, useRead } from "../../../../src/ui/lib/data/query.ts";
import { fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
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

function Tests() {
  const list = useRead("tests.list", {});
  return <p>{list.data ? "tests read" : "waiting"}</p>;
}

describe("ServerLost", () => {
  it("says on top that Testimus is not answering while requests cannot reach it, and leaves when it answers", async () => {
    const answer = globalThis.fetch;
    let down = true;
    net.routes["tests.list"] = () => [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (down) throw new TypeError("Failed to fetch");
        return answer(url, init);
      }),
    );
    withData(
      <>
        <ServerLost />
        <Tests />
      </>,
    );
    expect(await screen.findByText("Testimus is not answering")).toBeInTheDocument();
    expect(screen.getByText(/what you type is kept and saved when it answers again/)).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
    down = false;
    expect(await screen.findByText("tests read", undefined, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Testimus is not answering")).toBeNull());
    expect(isReachable()).toBe(true);
  });
});
