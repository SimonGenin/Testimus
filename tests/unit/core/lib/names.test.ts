import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { listJobs, waitJob } from "../../../../src/core/jobs.ts";
import {
  docName,
  quoted,
  scopeName,
  testName,
  testsName,
  UNTITLED_DOC,
  UNTITLED_TEST,
} from "../../../../src/core/lib/names.ts";
import { call, fixtureCopy } from "../registry.ts";

const DOC = "SOSIE_211_D401-1_3";
const LOCAL = "local-3f9a12c0";
const SUMMARY = "Sectionneur avec TK — manœuvre régulière";

describe("names: what the core calls a test, a document, a scope", () => {
  it("a test by its summary, never by a local id", () => {
    const p = fixtureCopy("names");
    expect(testName(p, LOCAL)).toBe(SUMMARY);
    expect(testName(p, "LFRPS12-1398")).toBe("Disjoncteur — ouverture à distance");
    expect(testName(p, "local-00000000")).toBe(UNTITLED_TEST);
    expect(testName(p, "LFRPS12-9999")).toBe("LFRPS12-9999");
    expect(testName(null, LOCAL)).toBe(UNTITLED_TEST);
    expect(testsName(p, [LOCAL])).toBe(SUMMARY);
    expect(testsName(p, [LOCAL, "LFRPS12-1398"])).toBe("2 tests");
    const md = join(p, "tests", LOCAL, "test.md");
    writeFileSync(md, readFileSync(md, "utf8").replace(`summary: ${SUMMARY}`, 'summary: ""'));
    expect(testName(p, LOCAL)).toBe(UNTITLED_TEST);
    expect(quoted(SUMMARY)).toBe(`« ${SUMMARY} »`);
  });

  it("a document by its title, a batch by its document and its title, a scope in words", () => {
    const p = fixtureCopy("names-doc");
    expect(docName(p, DOC)).toBe("Traction");
    expect(docName(p, "NOPE")).toBe("NOPE");
    expect(scopeName(p, { kind: "test", testId: LOCAL })).toBe(SUMMARY);
    expect(scopeName(p, { kind: "step", testId: LOCAL, step: 2 })).toBe(`${SUMMARY} · step 2`);
    expect(scopeName(p, { kind: "doc", docId: DOC })).toBe("Traction");
    expect(scopeName(p, { kind: "tests", testIds: [LOCAL, "LFRPS12-1398"] })).toBe("2 tests");
    expect(scopeName(p, { kind: "project" })).toBe("the project");
    const json = join(p, "docs", DOC, "doc.json");
    writeFileSync(json, readFileSync(json, "utf8").replace('"title": "Traction"', '"title": ""'));
    expect(docName(p, DOC)).toBe(UNTITLED_DOC);
  });

  it("a job started through the registry carries the name of what it works on as its label", async () => {
    const p = fixtureCopy("names-job");
    const { jobId } = (await invoke("check.run", { ids: [LOCAL], semantic: false }, { project: p, wait: false })) as {
      jobId: string;
    };
    await waitJob(jobId);
    const job = listJobs(p).find((j) => j.id === jobId);
    expect(job?.subject).toBe(LOCAL);
    expect(job?.label).toBe(SUMMARY);
    const listed = await call<{ id: string; label?: string }[]>("jobs.list", {}, p);
    expect(listed.find((j) => j.id === jobId)?.label).toBe(SUMMARY);
  });
});
