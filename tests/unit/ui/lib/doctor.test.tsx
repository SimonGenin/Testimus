// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { resetDoctor, runDoctor, useDoctor, worst } from "../../../../src/ui/lib/doctor.ts";
import { callsOf, Fail, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { noDesktop } from "../../ui-desktop-helpers.tsx";

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

describe("doctor store", () => {
  const c = (id: string, state: DoctorCheck["state"]): DoctorCheck => ({ id, label: id, state, detail: "" });

  beforeEach(() => resetDoctor());

  it("rates the worst check", () => {
    expect(worst([])).toBe("ok");
    expect(worst([c("a", "ok"), c("b", "fail")])).toBe("fail");
    expect(worst([c("a", "warn")])).toBe("warn");
    expect(worst([c("a", "skip"), c("b", "skip")])).toBe("skip");
    expect(worst([c("a", "skip"), c("b", "ok")])).toBe("ok");
  });

  it("keeps the last real sign-in answer across a run without the probe", async () => {
    net.routes["system.doctor"] = (i) =>
      i.claude ? { checks: [c("claudeLogin", "ok")] } : [c("claudeLogin", "skip"), c("node", "skip")];
    const { result } = renderHook(() => useDoctor());
    await act(() => runDoctor(true));
    expect(callsOf("system.doctor")[0].input).toEqual({ claude: true });
    const merged = await act(() => runDoctor());
    expect(merged.map((x) => x.state)).toEqual(["ok", "skip"]);
    expect(result.current.at).toBeGreaterThan(0);
    resetDoctor();
    expect((await runDoctor()).map((x) => x.state)).toEqual(["skip", "skip"]);
    net.routes["system.doctor"] = () => null;
    expect(await runDoctor()).toEqual([]);
  });

  it("keeps the checks and says why when the run fails", async () => {
    net.routes["system.doctor"] = () => [c("node", "ok")];
    await runDoctor();
    net.routes["system.doctor"] = () => {
      throw new Fail("core down", 500);
    };
    const { result } = renderHook(() => useDoctor());
    expect(await act(() => runDoctor())).toEqual([c("node", "ok")]);
    expect(result.current.error).toBe("core down");
    expect(result.current.running).toBe(false);
    vi.stubGlobal("fetch", () => Promise.reject("offline"));
    await act(() => runDoctor());
    expect(result.current.error).toBe("offline");
  });
});
