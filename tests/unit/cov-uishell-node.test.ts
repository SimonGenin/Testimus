import { describe, expect, it } from "vitest";
import { desktop, pathOf } from "../../src/ui/lib/desktop.ts";

describe("lib/desktop outside a browser", () => {
  it("has no bridge when there is no window", () => {
    expect(desktop()).toBeNull();
    expect(pathOf({} as File)).toBe("");
  });
});
