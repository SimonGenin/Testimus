import { existsSync, readFileSync } from "node:fs";
import { env, type HttpReq, type HttpRes } from "../env.ts";
import { adfToText, textToAdf } from "../lib/adf.ts";

type MAttachment = { id: string; filename: string };
type MStep = {
  id: string;
  action: string;
  data: string;
  result: string;
  custom: Record<string, string>;
  attachments: MAttachment[];
};
type MTest = {
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
};
type MPrecondition = { issueId: string; key: string; summary: string; definition: string };
type MState = {
  tests: Map<string, MTest>;
  preconditions: MPrecondition[];
  folders: string[];
  files: Map<string, Uint8Array>;
  imports: Map<string, unknown>;
  seq: number;
};

export const MOCK_JIRA = "https://mock.atlassian.net";
export const MOCK_JWT = "mock-jwt";
export const MOCK_PROJECT = { id: "12445", key: "LFRPS12", name: "RATP Sosie", testTypeId: "10935" };
export const MOCK_ME = { accountId: "mock-account-1", displayName: "Mock Tester", emailAddress: "tester@example.com" };
export const EXIGENCE_ID = "cf-exigence";

// ponytail: the one switch that makes a push fail on purpose — Jira refuses attachments over 10 MB, and
// TESTIMUS_MOCK_MAX_ATTACHMENT=<bytes> lowers the bar so the UI's "push stopped" path is reachable;
// TESTIMUS_MOCK_JIRA_MS=<ms> slows every request (an image five times more) so a pull can be watched
export const mockJira = {
  maxAttachmentBytes: Number(process.env.TESTIMUS_MOCK_MAX_ATTACHMENT) || 10 * 1024 * 1024,
  latencyMs: Number(process.env.TESTIMUS_MOCK_JIRA_MS) || 40,
};

const STEP_FIELDS = [
  { id: "action", name: "action", type: "text", required: false, disabled: false, values: null },
  { id: "data", name: "data", type: "text", required: false, disabled: false, values: null },
  { id: "result", name: "result", type: "text", required: false, disabled: false, values: null },
  { id: EXIGENCE_ID, name: "Exigence", type: "text-single", required: false, disabled: false, values: null },
];

const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function fixtureBytes(rel: string): Uint8Array {
  const url = new URL(`../../../tests/fixtures/${rel}`, import.meta.url);
  return existsSync(url) ? new Uint8Array(readFileSync(url)) : PNG_1PX;
}

const step = (id: string, action: string, result: string, exigence = "", data = ""): MStep => ({
  id,
  action,
  data,
  result,
  custom: exigence ? { [EXIGENCE_ID]: exigence } : {},
  attachments: [],
});

const test = (t: Partial<MTest> & Pick<MTest, "issueId" | "key" | "summary" | "folder" | "steps">): MTest => ({
  labels: [],
  status: "To Do",
  description: "",
  preconditions: [],
  links: [],
  ...t,
});

function seed(): MState {
  const s1420 = [
    step(
      "101",
      "Ouvrir la vue de traction de la ligne 92 et repérer le sectionneur S 12.",
      "Le sectionneur S 12 est affiché sur la schématique de traction avec le symbole du sectionneur.\n\n!xray-attachment://9001|width=320,height=160!",
      "EXI_MOP_SPF_511_A_1650",
    ),
    step(
      "102",
      "Clic droit sur le sectionneur S 12 de la vue de traction.",
      "Le menu propose les commandes du sectionneur.",
      "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20",
    ),
    step(
      "103",
      "Choisir Propriétés.",
      "Une fenêtre affiche l'état de la position, les heures de la dernière autorisation et confirmation d'ouverture et de fermeture, et les points kilométriques voie 1 et voie 2.\n\n||Champ||Valeur attendue||\n|Position|Fermé|\n|PK voie 1|12,480|",
      "EXI_MOP_SPF_511_A_1680",
      "Sectionneur S 12, position fermée.",
    ),
    step(
      "104",
      "Choisir Autoriser l'ouverture puis Confirmer l'ouverture.",
      "Le symbole du sectionneur S 12 passe à l'état ouvert sans ouvrir de fenêtre.",
      "EXI_MOP_SPF_511_A_1660",
    ),
    step(
      "105",
      "Faire circuler un train sur la section du sectionneur ouvert.",
      "La traction n'est pas simulée : le train garde sa vitesse.",
      "EXI_MOP_SPF_511_A_1660",
    ),
  ];
  s1420[0].attachments = [{ id: "9001", filename: "fig-40.png" }];
  const tests = [
    test({
      issueId: "41420",
      key: "LFRPS12-1420",
      summary: "Sectionneur sans TK — menu contextuel et propriétés",
      folder: "/Traction/Sectionneurs",
      labels: ["testimus-draft"],
      description:
        "Vérifie le menu contextuel et la fenêtre Propriétés d'un sectionneur sans télécommande (TK) sur la vue de traction. Technique boîte noire : partition par type de sectionneur.",
      preconditions: ["30077"],
      links: [{ type: "Test", key: "LFRPS12-880" }],
      steps: s1420,
    }),
    test({
      issueId: "41398",
      key: "LFRPS12-1398",
      summary: "Disjoncteur — ouverture à distance",
      folder: "/Traction/Disjoncteurs",
      labels: ["testimus-validated"],
      description: "Vérifie l'ouverture à distance d'un disjoncteur depuis le PCC.",
      steps: [
        step(
          "201",
          "Clic droit sur le disjoncteur D 4 de la vue de traction.",
          "Le menu propose Ouvrir, Fermer et Propriétés.",
        ),
      ],
    }),
    test({
      issueId: "41401",
      key: "LFRPS12-1401",
      summary: "Disjoncteur — fermeture à distance",
      folder: "/Traction/Disjoncteurs",
      description: "Vérifie la fermeture à distance d'un disjoncteur ouvert.",
      preconditions: ["30077"],
      steps: [
        step("211", "Clic droit sur le disjoncteur D 4 ouvert.", "Le menu propose Fermer.", "EXI_MOP_SPF_511_A_1700"),
        step("212", "Choisir Fermer.", "Le disjoncteur D 4 passe à l'état fermé.", "EXI_MOP_SPF_511_A_1710"),
      ],
    }),
    test({
      issueId: "41405",
      key: "LFRPS12-1405",
      summary: "Sectionneur avec TK — propriétés",
      folder: "/Traction/Sectionneurs",
      labels: ["regression"],
      steps: [
        step("221", "Clic droit sur un sectionneur avec TK.", "Seul Propriétés est proposé.", "EXI_MOP_SPF_511_A_1670"),
        step("222", "Choisir Propriétés.", "La fenêtre Propriétés s'ouvre.", "EXI_MOP_SPF_511_A_1680"),
      ],
    }),
    test({
      issueId: "41410",
      key: "LFRPS12-1410",
      summary: "Signal — passage au rouge",
      folder: "/Signalisation",
      status: "In Progress",
      steps: [
        step(
          "231",
          "Occuper le canton en aval du signal S 3.",
          "Le signal S 3 passe au rouge.",
          "EXI_MOP_SPF_520_A_10",
        ),
      ],
    }),
    test({
      issueId: "41411",
      key: "LFRPS12-1411",
      summary: "Signal — feu clignotant",
      folder: "/Signalisation",
      steps: [
        step(
          "241",
          "Commander le feu clignotant du signal S 3.",
          "Le feu du signal S 3 clignote.",
          "EXI_MOP_SPF_520_A_20",
        ),
      ],
    }),
  ];
  return {
    tests: new Map(tests.map((t) => [t.key, t])),
    preconditions: [
      {
        issueId: "30077",
        key: "LFRPS12-77",
        summary: "Exercice chargé sur la ligne 92",
        definition: "# Le logiciel R³ est lancé.\n# Un exercice de la ligne 92 est chargé.",
      },
      {
        issueId: "30078",
        key: "LFRPS12-78",
        summary: "Un train circule sur la ligne 92",
        definition: "# Un train autonome circule sur la ligne 92.",
      },
    ],
    folders: ["/Traction", "/Traction/Sectionneurs", "/Traction/Disjoncteurs", "/Signalisation"],
    files: new Map([["9001", fixtureBytes("project/tests/LFRPS12-1420/images/fig-40.png")]]),
    imports: new Map(),
    seq: 0,
  };
}

let state: MState | null = null;

export function resetMockJira(): void {
  state = null;
}

function st(): MState {
  if (!state) state = seed();
  return state;
}

export function mockJiraTest(key: string): MTest | undefined {
  return st().tests.get(key);
}

const next = () => ++st().seq;

const json = (body: unknown, status = 200): HttpRes => ({
  status,
  headers: { "content-type": "application/json" },
  text: JSON.stringify(body),
});
const empty = (status: number): HttpRes => ({ status, headers: {}, text: "" });
const notFound = (what: string) => json({ errorMessages: [`${what} does not exist`] }, 404);
const gqlError = (message: string) => json({ errors: [{ message }] });

function precondition(p: MPrecondition) {
  return { issueId: p.issueId, definition: p.definition, jira: { key: p.key, summary: p.summary } };
}

function rawStep(s: MStep) {
  return {
    id: s.id,
    action: s.action,
    data: s.data || null,
    result: s.result,
    attachments: s.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      downloadLink: `${MOCK_JIRA}/rest/api/3/attachment/content/${a.id}`,
    })),
    customFields: Object.entries(s.custom).map(([id, value]) => ({
      id,
      name: STEP_FIELDS.find((f) => f.id === id)?.name ?? id,
      value,
    })),
  };
}

function rawTest(t: MTest) {
  const pre = st().preconditions.filter((p) => t.preconditions.includes(p.issueId));
  return {
    issueId: t.issueId,
    projectId: MOCK_PROJECT.id,
    testType: { name: "Manual" },
    folder: { path: t.folder },
    jira: { key: t.key, summary: t.summary, status: { name: t.status }, labels: t.labels },
    steps: t.steps.map(rawStep),
    preconditions: { total: pre.length, results: pre.map(precondition) },
  };
}

function folderNode(path: string): unknown {
  const s = st();
  const all = new Set([...s.folders, ...[...s.tests.values()].map((t) => t.folder).filter(Boolean)]);
  const children = [...all]
    .filter((p) => p !== path && p.startsWith(path === "/" ? "/" : `${path}/`))
    .filter((p) => !p.slice(path === "/" ? 1 : path.length + 1).includes("/"))
    .sort();
  return {
    name: path === "/" ? "/" : path.split("/").pop(),
    path,
    testsCount: [...s.tests.values()].filter((t) => (t.folder || "/") === path).length,
    folders: children.map(folderNode),
  };
}

function matchJql(t: MTest, jql: string): boolean {
  const keys = [
    ...[...jql.matchAll(/\bkey\s*=\s*"?([A-Za-z][A-Za-z0-9]*-\d+)/g)].map((m) => m[1]),
    ...[...jql.matchAll(/\bkey\s+in\s*\(([^)]*)\)/g)].flatMap((m) => m[1].split(",").map((k) => k.trim())),
  ];
  const needle = /summary\s*~\s*"((?:[^"\\]|\\.)*)"/.exec(jql)?.[1]?.replace(/\\(.)/g, "$1");
  const linked = /linkedIssues\("([^"]+)"\)/.exec(jql)?.[1];
  if (!keys.length && needle === undefined && !linked) return true;
  if (keys.includes(t.key)) return true;
  if (needle !== undefined) {
    const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.every((w) => t.summary.toLowerCase().includes(w))) return true;
  }
  return !!linked && t.links.some((l) => l.key === linked);
}

function decode(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

type AttIn = { filename: string; mimeType?: string; data: string };
type StepIn = {
  action?: string;
  data?: string;
  result?: string;
  attachments?: AttIn[] | { add?: AttIn[]; removeIds?: string[] };
  customFields?: Array<{ id: string; value: unknown }>;
};

const size = (n: number) =>
  n >= 1048576 ? `${+(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${+(n / 1024).toFixed(1)} KB` : `${n} bytes`;

function upload(list: AttIn[]): MAttachment[] {
  for (const a of list) {
    const bytes = decode(a.data);
    if (bytes.length > mockJira.maxAttachmentBytes)
      throw new Error(
        `Attachment ${a.filename} is ${size(bytes.length)} — over the ${size(mockJira.maxAttachmentBytes)} Jira accepts.`,
      );
  }
  return list.map((a) => {
    const id = `m-att-${next()}`;
    st().files.set(id, decode(a.data));
    return { id, filename: a.filename };
  });
}

function applyStep(s: MStep, input: StepIn): void {
  const att = input.attachments;
  const added = upload(Array.isArray(att) ? att : (att?.add ?? []));
  if (input.action !== undefined) s.action = input.action;
  if (input.data !== undefined) s.data = input.data;
  if (input.result !== undefined) s.result = input.result;
  for (const cf of input.customFields ?? []) {
    if (!STEP_FIELDS.some((f) => f.id === cf.id)) throw new Error(`Custom field ${cf.id} does not exist.`);
    const v = cf.value == null ? "" : String(cf.value);
    if (v) s.custom[cf.id] = v;
    else delete s.custom[cf.id];
  }
  if (att && !Array.isArray(att)) s.attachments = s.attachments.filter((a) => !att.removeIds?.includes(a.id));
  s.attachments.push(...added);
}

function newStep(input: StepIn): MStep {
  if (!(input.action ?? "").length) throw new Error("one of 'action' or 'callTestIssueId' is required");
  const s: MStep = { id: `m-step-${next()}`, action: "", data: "", result: "", custom: {}, attachments: [] };
  applyStep(s, input);
  return s;
}

function byIssueId(issueId: string): MTest {
  const t = [...st().tests.values()].find((x) => x.issueId === issueId);
  if (!t) throw new Error(`Test with id ${issueId} not found.`);
  return t;
}

function byStepId(stepId: string): { t: MTest; i: number } {
  for (const t of st().tests.values()) {
    const i = t.steps.findIndex((s) => s.id === stepId);
    if (i >= 0) return { t, i };
  }
  throw new Error(`Step ${stepId} not found.`);
}

function createTest(jira: Record<string, any>, steps: StepIn[], folder?: string, pre?: string[]) {
  if (jira.project?.key !== MOCK_PROJECT.key) throw new Error(`project: project ${jira.project?.key} does not exist`);
  if (!jira.summary) throw new Error("summary: You must specify a summary of the issue.");
  if (jira.description !== undefined && typeof jira.description !== "string")
    throw new Error("description: Operation value must be a string");
  const built = (steps ?? []).map(newStep);
  const n = 1500 + next();
  const t = test({
    issueId: String(50000 + n),
    key: `${MOCK_PROJECT.key}-${n}`,
    summary: jira.summary,
    folder: folder || "/",
    labels: jira.labels ?? [],
    description: jira.description ?? "",
    preconditions: pre ?? [],
    steps: built,
  });
  st().tests.set(t.key, t);
  return t;
}

function graphql(query: string, v: Record<string, any>): HttpRes {
  const s = st();
  const has = (name: string) => new RegExp(`\\b${name}\\s*\\(`).test(query);
  try {
    if (has("createTest")) {
      const t = createTest(v.jira ?? {}, v.steps ?? [], v.folder, v.preconditions);
      return json({ data: { createTest: { test: { issueId: t.issueId, jira: { key: t.key } }, warnings: [] } } });
    }
    if (has("addTestStep")) {
      const t = byIssueId(v.issueId);
      const created = newStep(v.step ?? {});
      t.steps.push(created);
      return json({ data: { addTestStep: { id: created.id } } });
    }
    if (has("updateTestStep")) {
      const { t, i } = byStepId(v.stepId);
      applyStep(t.steps[i], v.step ?? {});
      return json({ data: { updateTestStep: { warnings: [] } } });
    }
    if (has("removeAllTestSteps")) {
      byIssueId(v.issueId).steps = [];
      return json({ data: { removeAllTestSteps: "ok" } });
    }
    if (has("removeTestStep")) {
      const { t, i } = byStepId(v.stepId);
      t.steps.splice(i, 1);
      return json({ data: { removeTestStep: "ok" } });
    }
    if (has("updateTestFolder")) {
      byIssueId(v.issueId).folder = v.folderPath;
      return json({ data: { updateTestFolder: "ok" } });
    }
    if (has("addPreconditionsToTest")) {
      const t = byIssueId(v.issueId);
      const ids = (v.ids ?? []) as string[];
      t.preconditions = [...new Set([...t.preconditions, ...ids])];
      return json({ data: { addPreconditionsToTest: { addedPreconditions: ids, warning: null } } });
    }
    if (has("removePreconditionsFromTest")) {
      const t = byIssueId(v.issueId);
      t.preconditions = t.preconditions.filter((id) => !(v.ids ?? []).includes(id));
      return json({ data: { removePreconditionsFromTest: "ok" } });
    }
    if (has("getProjectSettings")) {
      const p = String(v.projectIdOrKey ?? "");
      if (p !== MOCK_PROJECT.id && p !== MOCK_PROJECT.key) return json({ data: { getProjectSettings: null } });
      return json({
        data: { getProjectSettings: { projectId: MOCK_PROJECT.id, testStepSettings: { fields: STEP_FIELDS } } },
      });
    }
    if (has("getFolder")) {
      const path = String(v.path || "/");
      const exists = path === "/" || folderNodeExists(path);
      return json({ data: { getFolder: exists ? folderNode(path) : null } });
    }
    if (has("getTests")) {
      let list = [...s.tests.values()];
      if (v.jql) list = list.filter((t) => matchJql(t, v.jql));
      else if (v.folder) {
        const path = v.folder.path || "/";
        list = list.filter((t) =>
          v.folder.includeDescendants
            ? path === "/" || t.folder === path || t.folder.startsWith(`${path}/`)
            : (t.folder || "/") === path,
        );
      }
      list.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
      const start = v.start ?? 0;
      const limit = v.limit ?? 100;
      return json({
        data: {
          getTests: { total: list.length, start, limit, results: list.slice(start, start + limit).map(rawTest) },
        },
      });
    }
    if (has("getPreconditions")) {
      const list = v.jql ? s.preconditions.filter((p) => new RegExp(`\\b${p.key}\\b`).test(v.jql)) : s.preconditions;
      return json({ data: { getPreconditions: { total: list.length, results: list.map(precondition) } } });
    }
    return gqlError("mock: unsupported GraphQL query");
  } catch (e) {
    return gqlError((e as Error).message);
  }
}

function folderNodeExists(path: string): boolean {
  const s = st();
  return s.folders.includes(path) || [...s.tests.values()].some((t) => t.folder === path);
}

type BulkTest = {
  testtype?: string;
  xray_test_repository_folder?: string;
  fields?: Record<string, any>;
  steps?: StepIn[];
};

function bulkImport(list: BulkTest[]): string {
  const jobId = `mock-import-${next()}`;
  const issues: unknown[] = [];
  const errors: unknown[] = [];
  list.forEach((b, elementNumber) => {
    try {
      const t = createTest(b.fields ?? {}, b.steps ?? [], b.xray_test_repository_folder);
      issues.push({ elementNumber, id: t.issueId, key: t.key, self: `${MOCK_JIRA}/rest/api/2/issue/${t.issueId}` });
    } catch (e) {
      errors.push({ elementNumber, errors: { message: (e as Error).message } });
    }
  });
  st().imports.set(jobId, { status: "successful", result: { errors, issues, warnings: [] } });
  return jobId;
}

function issueJson(t: MTest) {
  return {
    id: t.issueId,
    key: t.key,
    fields: {
      summary: t.summary,
      labels: t.labels,
      status: { name: t.status },
      description: t.description ? textToAdf(t.description) : null,
      issuelinks: t.links.map((l, i) => ({
        id: String(70000 + i),
        type: { name: l.type },
        outwardIssue: { key: l.key },
      })),
    },
  };
}

export async function mockHttp(req: HttpReq): Promise<HttpRes> {
  const ms = mockJira.latencyMs;
  if (env.mock) await new Promise((r) => setTimeout(r, req.url.includes("/attachment/content/") ? ms * 5 : ms));
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const body = () => JSON.parse(req.body || "{}");
  const s = st();

  if (path === "/api/v2/authenticate" && req.method === "POST") {
    const b = body();
    if (!b.client_id || !b.client_secret) return json({ error: "Authentication failed" }, 401);
    return { status: 200, headers: {}, text: JSON.stringify(MOCK_JWT) };
  }
  if (path === "/api/v2/graphql" && req.method === "POST") {
    if ((req.headers?.Authorization ?? "") !== `Bearer ${MOCK_JWT}`) return json({ error: "Unauthorized" }, 401);
    const b = body();
    return graphql(String(b.query ?? ""), b.variables ?? {});
  }
  if (path === "/api/v2/import/test/bulk" && req.method === "POST") {
    const list = body();
    if (!Array.isArray(list)) return json({ error: "Expected a JSON array of tests" }, 400);
    return json({ jobId: bulkImport(list) });
  }
  const job = /^\/api\/v2\/import\/test\/bulk\/([^/]+)\/status$/.exec(path);
  if (job) {
    const r = s.imports.get(job[1]);
    return r ? json(r) : json({ error: `Import job ${job[1]} not found` }, 404);
  }

  if (path === "/rest/api/3/myself") return json(MOCK_ME);
  const proj = /^\/rest\/api\/3\/project\/([^/]+)$/.exec(path);
  if (proj) {
    if (proj[1] !== MOCK_PROJECT.key && proj[1] !== MOCK_PROJECT.id) return notFound(`Project ${proj[1]}`);
    return json({
      id: MOCK_PROJECT.id,
      key: MOCK_PROJECT.key,
      name: MOCK_PROJECT.name,
      issueTypes: [
        { id: "10001", name: "Task" },
        { id: MOCK_PROJECT.testTypeId, name: "Xray Test" },
        { id: "10936", name: "Precondition" },
      ],
    });
  }
  const att = /^\/rest\/api\/3\/attachment\/content\/([^/]+)$/.exec(path);
  if (att) {
    const bytes = s.files.get(att[1]);
    if (!bytes) return notFound(`Attachment ${att[1]}`);
    return req.binary
      ? { status: 200, headers: { "content-type": "image/png" }, bytes }
      : { status: 200, headers: {}, text: "" };
  }
  const issue = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path);
  if (issue) {
    const t = s.tests.get(issue[1]);
    if (!t) return notFound(`Issue ${issue[1]}`);
    if (req.method === "GET") return json(issueJson(t));
    if (req.method === "PUT") {
      const f = body().fields ?? {};
      if (f.summary !== undefined) t.summary = f.summary;
      if (f.labels !== undefined) t.labels = f.labels;
      if (f.description !== undefined) t.description = adfToText(f.description);
      return empty(204);
    }
  }
  if (path === "/rest/api/3/issueLink" && req.method === "POST") {
    const b = body();
    const from = s.tests.get(b.inwardIssue?.key);
    if (!from) return notFound(`Issue ${b.inwardIssue?.key}`);
    if (!from.links.some((l) => l.type === b.type?.name && l.key === b.outwardIssue?.key))
      from.links.push({ type: b.type?.name, key: b.outwardIssue?.key });
    return empty(201);
  }
  return json({ error: `mock: no fixture for ${req.method} ${req.url}` }, 404);
}
