import { describe, expect, it } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { apply, applyJobEvent, keysOfKind, keysOfPaths } from "../../../../src/ui/lib/data/events.ts";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";

const names = (paths: string[]) => keysOfPaths(paths).map((k) => k[0]);

describe("which reads a changed file refreshes", () => {
  it("a test's remote copy refreshes the test, what Claude changed since, the list, its push plan and its Jira status", () => {
    expect(keysOfPaths(["tests/T-1/.remote.md"])).toEqual([
      ["tests.show", { id: "T-1" }],
      ["claude.before", { testId: "T-1" }],
      ["tests.list"],
      ["xray.plan", { id: "T-1" }],
      ["xray.status", { id: "T-1" }],
    ]);
  });

  it("a test's images, its state file and any other file of its folder refresh what shows that test", () => {
    expect(keysOfPaths(["tests/T-1/images/fig.png"])).toEqual([["tests.show", { id: "T-1" }]]);
    expect(keysOfPaths(["tests/T-1/.state.json"])).toEqual([["tests.show", { id: "T-1" }], ["tests.list"]]);
    expect(names(["tests/T-2/notes.txt"])).toEqual([
      "tests.show",
      "tests.list",
      "review.queue",
      "project.info",
      "gen.preview",
    ]);
    expect(keysOfPaths(["tests/T-2"])[0]).toEqual(["tests.show", { id: "T-2" }]);
  });

  it("a document's context refreshes the document only; another file of its folder refreshes the lists", () => {
    expect(keysOfPaths(["docs/D-1/context.md"])).toEqual([["docs.show", { id: "D-1" }]]);
    expect(names(["docs/D-1/original.docx"])).toEqual(["docs.list", "rag.status", "project.info", "gen.preview"]);
  });

  it("the columns and Xray's step schema refresh the project and the columns", () => {
    expect(names(["columns.json"])).toEqual(["project.info", "columns.list"]);
    expect(names(["xray.json"])).toEqual(["project.info", "columns.list"]);
  });

  it("several files add their reads in order, and a file nobody shows refreshes nothing", () => {
    expect(names(["CLAUDE.md", "contexts/a.md"])).toEqual([
      "project.notes",
      "claude.prompts",
      "contexts.list",
      "contexts.show",
      "contexts.ofTest",
      "contexts.ofProject",
      "claude.prompts",
    ]);
    expect(keysOfPaths(["README.txt", ".testimus/jobs/j1.jsonl"])).toEqual([]);
  });
});

describe("which reads a finished job refreshes", () => {
  it("the search index refreshes the search, a push the Jira reads, a pull Jira's search", () => {
    expect(keysOfKind("search-index")).toEqual([["search.all"]]);
    expect(keysOfKind("push")).toEqual([["xray.status"], ["xray.folders"], ["xray.search"]]);
    expect(keysOfKind("pull")).toEqual([["xray.search"]]);
  });

  it("a conversation with the documents refreshes the earlier conversations and the one it continued", () => {
    expect(keysOfKind("chat")).toEqual([["chat.list"], ["chat.show"]]);
    expect(keysOfKind("chats")).toEqual([]);
  });
});

describe("a job's processes", () => {
  it("a process event adds the program to its job, and the same program again replaces it", () => {
    const job = { id: "j1", kind: "generate", subject: "s", status: "running" } as Job;
    const other = { id: "j2", kind: "generate", subject: "s", status: "running" } as Job;
    const started = {
      jobId: "j1",
      at: "",
      type: "process",
      process: { id: "p1", pid: 41, program: "claude" },
    } as unknown as JobEvent;
    const ended = {
      jobId: "j1",
      at: "",
      type: "process",
      process: { id: "p1", pid: 41, program: "claude", exit: 0 },
    } as unknown as JobEvent;
    const once = applyJobEvent([job, other], started);
    expect(once[0].processes).toEqual([{ id: "p1", pid: 41, program: "claude" }]);
    expect(once[1]).toBe(other);
    expect(applyJobEvent(once, ended)[0].processes).toEqual([{ id: "p1", pid: 41, program: "claude", exit: 0 }]);
  });
});

describe("a change of the whole project", () => {
  it("re-reads every read of this project and none of another project", () => {
    const client = createQueryClient();
    client.setQueryData(["/p", "tests.list"], []);
    client.setQueryData(["/p", "docs.show", { id: "D-1" }], {});
    client.setQueryData(["/q", "tests.list"], []);
    apply(client, { jobId: "", at: "", type: "changed", paths: [""], project: "/p" } as JobEvent, "/p");
    expect(client.getQueryState(["/p", "tests.list"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["/p", "docs.show", { id: "D-1" }])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["/q", "tests.list"])?.isInvalidated).toBe(false);
  });
});
