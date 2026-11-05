import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentExe } from "../../../src/desktop/core.ts";

let root = "";
const exe = (v: string) => join(root, v, "Testimus.exe");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-relaunch-"));
  for (const v of ["0.3.0", "0.4.0"]) {
    mkdirSync(join(root, v), { recursive: true });
    writeFileSync(exe(v), "");
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the exe a restart starts", () => {
  it("is the current version's after an update", () => {
    writeFileSync(join(root, "current.txt"), "﻿0.4.0\r\n");
    expect(currentExe(join(root, "0.3.0"), exe("0.3.0"))).toBe(exe("0.4.0"));
  });

  it("is this one when nothing better is known: no current.txt, a missing folder, a path in it", () => {
    const self = exe("0.3.0");
    expect(currentExe(join(root, "0.3.0"), self)).toBe(self);
    writeFileSync(join(root, "current.txt"), "0.9.0");
    expect(currentExe(join(root, "0.3.0"), self)).toBe(self);
    writeFileSync(join(root, "current.txt"), "..\\0.4.0");
    expect(currentExe(join(root, "0.3.0"), self)).toBe(self);
    writeFileSync(join(root, "current.txt"), "  ");
    expect(currentExe(join(root, "0.3.0"), self)).toBe(self);
    expect(
      currentExe(join(root, "0.3.0"), self, () => {
        throw new Error("EACCES");
      }),
    ).toBe(self);
  });
});
