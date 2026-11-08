// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { scopeWords } from "../../../../src/ui/lib/actions.ts";
import { activityOf } from "../../../../src/ui/lib/activity.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { subjectLabel } from "../../../../src/ui/lib/jobs.ts";
import { contextLabel, isLocalId, nameTests, testLabel, testRef, useTestNames } from "../../../../src/ui/lib/labels.ts";
import { placeOfPath } from "../../../../src/ui/screens/jobs/JobFiles.tsx";
import { fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";

const SUMMARY = "Sectionneur avec TK — manœuvre régulière";
const names = (id: string) => (id === "local-3f9a12c0" ? SUMMARY : undefined);
const job = (o: Partial<Job>): Job => ({
  id: "fix-12345678",
  kind: "fix",
  subject: "local-3f9a12c0",
  status: "done",
  startedAt: "2026-11-08T10:00:00Z",
  ...o,
});
const at = "2026-11-08T10:00:01Z";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  cleanup();
  setProject(null);
});

describe("labels: what the page calls a test, a document, a context", () => {
  it("a name, else « Untitled … », never the id", () => {
    expect(testLabel({ summary: `  ${SUMMARY} ` })).toBe(SUMMARY);
    expect(testLabel({ summary: "" })).toBe("Untitled test");
    expect(testLabel(null)).toBe("Untitled test");
    expect(testRef({ key: "LFRPS12-1398", summary: "Disjoncteur" })).toBe("LFRPS12-1398 Disjoncteur");
    expect(testRef({ summary: SUMMARY })).toBe(SUMMARY);
    expect(contextLabel({ name: "Glossaire" })).toBe("Glossaire");
    expect(contextLabel({ name: "" })).toBe("Untitled context");
    expect(isLocalId("local-3f9a12c0")).toBe(true);
    expect(isLocalId("LFRPS12-1398")).toBe(false);
  });

  it("a text that names local tests by id reads with their summaries", () => {
    expect(nameTests("Opened local-3f9a12c0 and local-00000000.", names)).toBe(
      `Opened “${SUMMARY}” and “Untitled test”.`,
    );
    expect(nameTests("Opened LFRPS12-1398", names)).toBe("Opened LFRPS12-1398");
  });

  it("a job says what it works on by its label, and an older one never by a local id", () => {
    const none = new Map<string, Job>();
    expect(subjectLabel(job({ label: SUMMARY }), none)).toBe(SUMMARY);
    expect(subjectLabel(job({}), none)).toBe("A local test");
    expect(subjectLabel(job({ subject: "local-3f9a12c0, local-11111111" }), none)).toBe("2 local tests");
    expect(subjectLabel(job({ subject: "LFRPS12-1398" }), none)).toBe("LFRPS12-1398");
  });

  it("a Claude action's scope and a changed file name the test", () => {
    expect(scopeWords({ kind: "step", testId: "local-3f9a12c0", step: 2 }, names)).toBe(`${SUMMARY} · step 2`);
    expect(scopeWords({ kind: "test", testId: "local-99999999" })).toBe("Untitled test · whole test");
    expect(placeOfPath("tests/local-3f9a12c0/test.md", names)).toEqual({
      name: SUMMARY,
      rest: "test.md",
      screen: "tests",
      id: "local-3f9a12c0",
    });
    expect(placeOfPath("tests\\local-00000000\\check.json", names)?.name).toBe("Untitled test");
    expect(placeOfPath("docs/SOSIE_211_D401-1_3/doc.md", names)?.name).toBe("SOSIE_211_D401-1_3");
    expect(placeOfPath("project.json", names)).toBeNull();
  });

  it("what Claude did names the tests: the check's verdicts, the tests opened, its own words", () => {
    const events: JobEvent[] = [
      {
        type: "claude",
        jobId: "j",
        at,
        event: { type: "tool", name: "mcp__testimus__tests_show", input: '{"id":"local-3f9a12c0"}' },
      },
      { type: "claude", jobId: "j", at, event: { type: "text", text: "Tests écrits : local-3f9a12c0 (4 steps)." } },
      { type: "progress", jobId: "j", at, message: `« ${SUMMARY} »: 1 error(s), 0 warning(s)` },
      { type: "progress", jobId: "j", at, message: "local-3f9a12c0: 0 error(s), 2 warning(s)" },
    ] as JobEvent[];
    const phases = activityOf(events, names);
    expect(JSON.stringify(phases.map((p) => [p.acts, p.said]))).not.toMatch(/local-3f9a12c0/);
    expect(phases.flatMap((p) => p.acts.map((a) => a.text))).toContain(`Opened “${SUMMARY}”`);
    expect(phases.flatMap((p) => p.said).join(" ")).toContain(`“${SUMMARY}”`);
    const verdicts = phases.flatMap((p) => p.verdicts);
    expect(verdicts.find((v) => v.name === SUMMARY)).toMatchObject({ errors: 1, warnings: 0 });
    expect(verdicts.find((v) => v.id === "local-3f9a12c0")).toMatchObject({ warnings: 2 });
  });

  it("useTestNames reads the project's tests, the ones being written too", async () => {
    setProject("C:\\p");
    net.routes["tests.list"] = (i) => [
      { id: "local-3f9a12c0", summary: SUMMARY, generating: i.generating },
      { id: "LFRPS12-1", key: "LFRPS12-1", summary: "" },
    ];
    const { result } = renderHook(() => useTestNames(), { wrapper: DataProvider });
    await waitFor(() => expect(result.current("local-3f9a12c0")).toBe(SUMMARY));
    expect(result.current("LFRPS12-1")).toBe("LFRPS12-1");
    expect(result.current("local-00000000")).toBeUndefined();
  });
});
