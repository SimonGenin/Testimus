// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { worst } from "../../../../src/ui/lib/doctor.ts";
import { fakeNet } from "../../helpers/ui-data.tsx";
import { noDesktop } from "../../helpers/ui-desktop.tsx";

beforeEach(() => fakeNet());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("doctor verdict", () => {
  const c = (id: string, state: DoctorCheck["state"]): DoctorCheck => ({ id, label: id, state, detail: "" });

  it("rates the worst check", () => {
    expect(worst([])).toBe("ok");
    expect(worst([c("a", "ok"), c("b", "fail")])).toBe("fail");
    expect(worst([c("a", "warn")])).toBe("warn");
    expect(worst([c("a", "skip"), c("b", "skip")])).toBe("skip");
    expect(worst([c("a", "skip"), c("b", "ok")])).toBe("ok");
  });
});
