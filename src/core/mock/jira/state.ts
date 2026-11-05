import { existsSync, readFileSync } from "node:fs";

export type MAttachment = { id: string; filename: string };
export type MStep = {
  id: string;
  action: string;
  data: string;
  result: string;
  custom: Record<string, string>;
  attachments: MAttachment[];
};
export type MTest = {
  issueId: string;
  key: string;
  summary: string;
  labels: string[];
  status: string;
  description: string;
  folder: string;
  steps: MStep[];
  preconditions: string[];
  links: Array<{ type: string; key: string }>;
  /** account id, null when nobody is assigned */
  assignee: string | null;
  comments: MComment[];
};
/** a comment's body is the app's text form (mentions written @[Name](id)) — the routes turn it into ADF and back */
export type MComment = { id: string; author: string; body: string; created: string; updated?: string };
export type MPerson = { accountId: string; displayName: string };
export type MPrecondition = { issueId: string; key: string; summary: string; definition: string };
export type MField = { id: string; name: string; type: string };
type MState = {
  tests: Map<string, MTest>;
  preconditions: MPrecondition[];
  folders: string[];
  files: Map<string, Uint8Array>;
  seq: number;
};

type Fixture = {
  project: { id: string; key: string; name: string; testTypeId: string };
  stepFields: MField[];
  tests: Array<
    Partial<MTest> &
      Pick<MTest, "issueId" | "key" | "summary" | "folder"> & {
        steps: Array<Partial<MStep> & Pick<MStep, "id" | "action" | "result">>;
      }
  >;
  preconditions: MPrecondition[];
  folders: string[];
  files: Record<string, string>;
  people: MPerson[];
};

const fixtureUrl = (rel: string) => new URL(`../../../../tests/fixtures/${rel}`, import.meta.url);

// ponytail: the fake Jira's starting data is a fixture next to the project it describes, not code
const FIXTURE: Fixture = JSON.parse(readFileSync(fixtureUrl("jira.json"), "utf8"));

export const MOCK_JIRA = "https://mock.atlassian.net";
export const MOCK_JWT = "mock-jwt";
export const MOCK_PROJECT = FIXTURE.project;
export const MOCK_ME = { accountId: "mock-account-1", displayName: "Mock Tester", emailAddress: "tester@example.com" };
export const STEP_FIELDS = FIXTURE.stepFields.map((f) => ({ ...f, required: false, disabled: false, values: null }));
export const MOCK_PEOPLE: MPerson[] = [
  { accountId: MOCK_ME.accountId, displayName: MOCK_ME.displayName },
  ...FIXTURE.people,
];

// ponytail: the fake Jira's workflow — what a transition is called, which statuses it leaves from, where it leads
export const WORKFLOW = [
  { id: "11", name: "Start testing", from: ["To Do", "Blocked"], to: "In Progress", category: "indeterminate" },
  { id: "21", name: "Mark as done", from: ["To Do", "In Progress"], to: "Done", category: "done" },
  { id: "31", name: "Block", from: ["To Do", "In Progress"], to: "Blocked", category: "indeterminate" },
  { id: "41", name: "Back to To Do", from: ["In Progress", "Done", "Blocked"], to: "To Do", category: "new" },
];
export const STATUS_CATEGORY: Record<string, string> = Object.fromEntries([
  ["To Do", "new"],
  ...WORKFLOW.map((w) => [w.to, w.category]),
]);

// ponytail: the one switch that makes a push fail on purpose — Jira refuses attachments over 10 MB, and
// TESTIMUS_MOCK_MAX_ATTACHMENT=<bytes> lowers the bar so the UI's "push stopped" path is reachable;
// TESTIMUS_MOCK_JIRA_MS=<ms> slows every request (an image five times more) so a pull can be watched
export const mockJira = {
  maxAttachmentBytes: Number(process.env.TESTIMUS_MOCK_MAX_ATTACHMENT) || 10 * 1024 * 1024,
  latencyMs: Number(process.env.TESTIMUS_MOCK_JIRA_MS) || 40,
  /** TESTIMUS_MOCK_JIRA_NO_COMMENT=1: Jira refuses every new comment (403), so the composer's « refused » path shows */
  refuseComments: process.env.TESTIMUS_MOCK_JIRA_NO_COMMENT === "1",
};

const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function fixtureBytes(rel: string): Uint8Array {
  const url = fixtureUrl(rel);
  return existsSync(url) ? new Uint8Array(readFileSync(url)) : PNG_1PX;
}

export const newTest = (
  t: Partial<MTest> & Pick<MTest, "issueId" | "key" | "summary" | "folder" | "steps">,
): MTest => ({
  labels: [],
  status: "To Do",
  description: "",
  preconditions: [],
  links: [],
  assignee: null,
  comments: [],
  ...t,
});

function seed(): MState {
  const tests = FIXTURE.tests.map((t) =>
    newTest({
      ...t,
      labels: [...(t.labels ?? [])],
      preconditions: [...(t.preconditions ?? [])],
      links: (t.links ?? []).map((l) => ({ ...l })),
      comments: (t.comments ?? []).map((c) => ({ ...c })),
      steps: t.steps.map((s) => ({
        ...s,
        data: s.data ?? "",
        custom: { ...(s.custom ?? {}) },
        attachments: (s.attachments ?? []).map((a) => ({ ...a })),
      })),
    }),
  );
  return {
    tests: new Map(tests.map((t) => [t.key, t])),
    preconditions: FIXTURE.preconditions.map((p) => ({ ...p })),
    folders: [...FIXTURE.folders],
    files: new Map(Object.entries(FIXTURE.files).map(([id, rel]) => [id, fixtureBytes(rel)])),
    seq: 0,
  };
}

let state: MState | null = null;

export function resetMockJira(): void {
  state = null;
}

export function st(): MState {
  if (!state) state = seed();
  return state;
}

export function mockJiraTest(key: string): MTest | undefined {
  return st().tests.get(key);
}

export const next = () => ++st().seq;
