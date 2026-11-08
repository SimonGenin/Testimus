import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { sampleDocx } from "../tests/fixtures/docx/sample.ts";

export type Server = {
  url: string;
  api: <T = unknown>(name: string, input?: unknown) => Promise<T>;
  waitJob: (id: string) => Promise<void>;
};

// ponytail: a shot is reached by its hash first (what moves least when labels change), then `prep` clicks what the
// hash cannot say; `page` replaces both for a page that is not the app. Ids are stable: the before/after comparison
// of a redesign matches shots by scenario/id, never by label
export type Shot = {
  id: string;
  note: string;
  hash?: string;
  prep?: (page: Page, s: Server) => Promise<void>;
  page?: (page: Page, s: Server) => Promise<void>;
  setup?: boolean;
  ready?: (page: Page) => Locator;
  sizes?: string[];
  scroll?: boolean;
  settle?: number;
  // ponytail: a shot that makes the API fail on purpose names the failed request the browser logs, and why
  expectErrors?: { pattern: RegExp; why: string };
};

const failedWith = (status: number, why: string) => ({
  pattern: new RegExp(`^Failed to load resource: the server responded with a status of ${status} `),
  why,
});

export type Scenario = {
  id: string;
  note: string;
  env: Record<string, string>;
  noServer?: boolean;
  // ponytail: why the scenario cannot run on this machine (data it copies is not here); skipped, not a failure
  skip?: string;
  before?: (s: Server) => Promise<void>;
  shots: Shot[];
};

const ROOT = join(import.meta.dirname, "..");
const T = 15_000;

// ponytail: a client's folder for Import a folder — the scan fixture, plus a file git does not keep
function clientFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "testimus-screens-folder-"));
  cpSync(join(ROOT, "tests", "fixtures", "folder"), dir, { recursive: true });
  writeFileSync(join(dir, "Thumbs.db"), "x");
  return dir;
}

function any(page: Page | Locator, name: string | RegExp): Locator {
  const by = (role: Parameters<Page["getByRole"]>[0]) => page.getByRole(role, { name });
  return by("button")
    .or(by("tab"))
    .or(by("radio"))
    .or(by("menuitem"))
    .or(by("menuitemradio"))
    .or(by("link"))
    .or(by("option"))
    .or(by("treeitem"))
    .first();
}

async function tap(page: Page | Locator, name: string | RegExp): Promise<void> {
  const el = any(page, name);
  await el.waitFor({ timeout: T });
  await el.click();
}

// ponytail: Settings › Models — a pack is an article named « X pack » holding « Use this pack » and « Measure »
const pickPack = (page: Page, pack: string) =>
  tap(page.getByRole("article", { name: `${pack} pack` }), "Use this pack");

// ponytail: a kit confirmation is an alertdialog
const modal = (page: Page | Locator, name?: string | RegExp) =>
  page.getByRole("dialog", name ? { name } : {}).or(page.getByRole("alertdialog", name ? { name } : {}));
const dialog = (page: Page, name?: string | RegExp) => modal(page, name).first().waitFor({ timeout: T });

const see = (page: Page, text: string | RegExp) => page.getByText(text).first().waitFor({ timeout: T });

// ponytail: one index run for the whole scenario (TESTIMUS_MOCK_INDEX_MS keeps it going), started by the first shot
async function indexing(page: Page, s: Server): Promise<void> {
  const running = (await s.api<{ kind: string }[]>("jobs.list", { running: true })) ?? [];
  if (!running.some((j) => j.kind === "rag-index")) await s.api("rag.index", {});
  await see(page, /Indexing · \d+ %|Indexing \d+ of \d+ documents|Indexing the documents/);
}

async function palette(page: Page, query?: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await dialog(page, "Search everything");
  if (query) {
    await page.getByRole("combobox", { name: "Search" }).fill(query);
    await page.waitForTimeout(800);
  }
}

async function dock(page: Page): Promise<Locator> {
  const d = page.getByRole("complementary", { name: "Claude" });
  await tap(d, "Open Claude");
  await d.getByRole("heading", { name: "Claude", exact: true }).waitFor({ timeout: T });
  return d;
}

async function ask(page: Page, question: string): Promise<void> {
  const d = await dock(page);
  await d.getByRole("textbox").first().fill(question);
  await tap(d, /^(Send|Ask)$/);
  await page.waitForTimeout(2500);
}

async function validate(s: Server, id: string): Promise<void> {
  await s.api("review.set", { id, decision: "validate" }).catch(() => {});
}

async function openGenerated(page: Page): Promise<void> {
  await page
    .getByRole("complementary", { name: "Review queue" })
    .getByRole("option", { name: /Sectionneur avec TK/ })
    .first()
    .click({ timeout: T });
  await page.waitForTimeout(500);
}

// ponytail: Generate asks first to replace the tests not validated yet, when there are some
async function generate(page: Page): Promise<void> {
  const again = page.getByRole("button", { name: "New request" });
  await again
    .or(page.getByRole("textbox", { name: "What should be tested?" }))
    .first()
    .waitFor({ timeout: T });
  if (await again.isVisible()) await again.click();
  await page.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await tap(page.getByRole("region", { name: "Request" }), /^Generate/);
  const replace = modal(page).first();
  await replace.or(page.getByText("Claude is writing")).first().waitFor({ timeout: T });
  if (await replace.isVisible()) await tap(replace, /^Delete and generate/);
}

const delay = (page: Page, pattern: string, ms: number) =>
  page.route(pattern, async (r) => {
    await new Promise((ok) => setTimeout(ok, ms));
    await r.continue().catch(() => {});
  });

const fail = (page: Page, pattern: string) =>
  page.route(pattern, (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"mock failure"}' }),
  );

const heading1 = (page: Page) => page.getByRole("heading", { level: 1 }).first();
const step = (page: Page, n: number) => page.getByRole("article", { name: `Step ${n}`, exact: true }).first();

// ponytail: a test still in review opens in Review; validated through the API, it opens in Tests only on a fresh
// load (the page keeps the review states it read)
async function openTest(page: Page, s: Server, id: string): Promise<void> {
  await validate(s, id);
  await page.goto("about:blank");
  await page.goto(`${s.url}/#/tests/${id}`);
  await step(page, 1).waitFor({ timeout: T });
}
const firstId = async (s: Server, cmd: string) => ((await s.api<{ id: string }[]>(cmd, {})) ?? [])[0]?.id ?? "";

const SETTINGS = [
  "project",
  "columns",
  "claude",
  "claude-dock",
  "claude-quickasks",
  "claude-contexts",
  "context",
  "search",
  "models",
  "access",
  "appearance",
];

function settingsShots(prefix = "settings"): Shot[] {
  return SETTINGS.map((s) => ({ id: `${prefix}-${s}`, note: `Settings › ${s}`, hash: `#/settings/${s}` }));
}

function shellShots(): Shot[] {
  return [
    { id: "doctor", note: "System check", hash: "#/doctor", settle: 2500 },
    {
      id: "palette-empty",
      note: "Search everywhere (Ctrl K), nothing typed",
      hash: "#/tests",
      prep: (p) => palette(p),
    },
    // ponytail: a key-like query — search.all never asks its meaning (a code is a question for words), and the mock's
    // embedder finds a neighbour for any word, so a plain word would never show the « nothing matches » state
    { id: "palette-nothing", note: "Search everywhere, no match", hash: "#/tests", prep: (p) => palette(p, "ZZQ-404") },
    {
      id: "project-menu",
      note: "Project menu",
      hash: "#/tests",
      prep: (p) => tap(p, /^Project /),
    },
    {
      id: "dock-open",
      note: "Claude dock open, nothing asked",
      hash: "#/documents",
      prep: async (p) => void (await dock(p)),
    },
  ];
}

const IMAGES = "RECETTE_TCO_12-10";
const FILM = "Manoeuvre_d_un_sectionneur_au_PCC";

function imageShots(): Shot[] {
  return [
    {
      id: "images-grid",
      note: "An images document: its pictures, anchors and Claude's reading",
      hash: `#/documents/${IMAGES}`,
    },
    {
      id: "images-large",
      note: "One image opened large",
      hash: `#/documents/${IMAGES}`,
      prep: async (p) => {
        await tap(p, /^img:1 /);
        await dialog(p, "IMG_0042.jpg");
      },
    },
    { id: "images-text", note: "An images document's text (doc.md)", hash: `#/documents/${IMAGES}%23§media` },
    {
      id: "images-add-choice",
      note: "Two images dropped together: one document or one each",
      hash: "#/documents",
      prep: async (p) => {
        await p.evaluate(() => {
          const dt = new DataTransfer();
          dt.items.add(new File(["x"], "IMG_0050.jpg", { type: "image/jpeg" }));
          dt.items.add(new File(["y"], "IMG_0051.jpg", { type: "image/jpeg" }));
          document
            .querySelector('[data-testid="documents-screen"]')
            ?.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        await dialog(p, "Add 2 images");
      },
    },
    { id: "images-text-doc", note: "A text document (.txt)", hash: "#/documents/Notes_de_reunion" },
  ];
}

// ponytail: How the documents fit together — written whole, then updated after a document changed (its banner)
async function overviewWritten(s: Server): Promise<void> {
  await s.api("project.set", { claude: { overview: { enabled: true, inEveryRun: true } } });
  const full = await s.api<{ jobId: string }>("docs.overview", { mode: "full" });
  await s.waitJob(full.jobId);
  await s.api("docs.set", { id: "SOSIE_211_D401-1_4", status: "validated" });
  const auto = await s.api<{ jobId: string }>("docs.overview", { mode: "auto" });
  await s.waitJob(auto.jobId);
}

function overviewShots(): Shot[] {
  const pane = (p: Page) => p.getByRole("region", { name: "How the documents fit together" });
  return [
    {
      id: "overview",
      note: "How the documents fit together: the list's head, the text, the switch, what the last update changed",
      hash: "#/documents/~overview",
      ready: (p) => pane(p).getByText(/^Last update changed/),
    },
    {
      id: "overview-changes",
      note: "Show changes: the last update, before and after",
      hash: "#/documents/~overview",
      prep: async (p) => {
        await tap(pane(p), "Show changes");
        await dialog(p, "Changes of the last update");
      },
    },
    {
      id: "overview-edit",
      note: "Edited by hand (autosave)",
      hash: "#/documents/~overview",
      prep: async (p) => {
        await tap(pane(p), "Edit");
        await see(p, "Saved as you type. Claude keeps what you write: the next update merges into it.");
      },
    },
    {
      id: "overview-rewrite",
      note: "Rewrite from scratch asks first",
      hash: "#/documents/~overview",
      prep: async (p) => {
        await tap(pane(p), "More");
        await tap(p, /Rewrite from scratch/);
        await dialog(p, "Rewrite it from scratch?");
      },
    },
    { id: "overview-setting", note: "Settings › Claude: the option", hash: "#/settings/claude-overview" },
  ];
}

function videoShots(): Shot[] {
  return [
    { id: "video", note: "A video document: player, chapters, transcript, key frames", hash: `#/documents/${FILM}` },
    {
      id: "video-moment",
      note: "A video opened at a moment a source names (t:00:47)",
      hash: `#/documents/${FILM}%23t:00:47`,
    },
    {
      id: "video-text",
      note: "A video's text: transcript lines and key frames",
      hash: `#/documents/${FILM}%23§video-1`,
    },
  ];
}

const DOC = "SOSIE_211_D401-1_3";
const DOC2 = "SOSIE_211_D401-1_4";
const T1420 = "LFRPS12-1420";
const T1398 = "LFRPS12-1398";
const TLOCAL = "local-3f9a12c0";
const RUN = "recette-j5-sectionneurs";

// ponytail: the #/kit catalogue (served under --mock), one shot per component: its page shows light and dark side by
// side, so one size is enough. The page is reached by the name the section declares, never by its file's name
export function kitSectionNames(): string[] {
  const dir = join(ROOT, "src", "ui", "screens", "kit", "sections");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => /\bname:\s*"([^"]+)"/.exec(readFileSync(join(dir, f), "utf8"))?.[1] ?? f.replace(/\.tsx$/, ""));
}

function kitShots(): Shot[] {
  return kitSectionNames().map((name) => ({
    id: `kit-${name.toLowerCase()}`,
    note: `Kit › ${name}`,
    hash: `#/kit/${name}`,
    sizes: ["lg"],
  }));
}

function fixtureShots(): Shot[] {
  return [
    // Documents
    { id: "documents", note: "Documents, first document open", hash: "#/documents" },
    { id: "documents-detail", note: "Document detail (Traction)", hash: `#/documents/${DOC}` },
    { id: "documents-detail-2", note: "Document detail (Signalisation, submitted)", hash: `#/documents/${DOC2}` },
    {
      id: "documents-anchor",
      note: "Document scrolled to a section",
      hash: `#/documents/${DOC}%23§5.6.6`,
      scroll: false,
    },
    {
      id: "documents-quote",
      note: "Document with a quote highlighted",
      hash: `#/documents/${encodeURIComponent(`${DOC}#§5.6.6 "Selon le type de sectionneur"`)}`,
      scroll: false,
    },
    {
      id: "documents-figures",
      note: "Document › Figures view",
      hash: `#/documents/${DOC}`,
      prep: (p) => tap(p, /^Figures/),
    },
    {
      id: "documents-figures-undescribed",
      note: "Figures › Not described",
      hash: `#/documents/${DOC}`,
      prep: async (p) => {
        await tap(p, /^Figures/);
        await tap(p, /^Not described/);
      },
    },
    {
      id: "documents-more-menu",
      note: "More actions for this document",
      hash: `#/documents/${DOC}`,
      prep: (p) => tap(p, "More actions for this document"),
    },
    {
      id: "documents-delete-dialog",
      note: "Delete this document? (confirmation)",
      hash: `#/documents/${DOC}`,
      prep: async (p) => {
        await tap(p, "More actions for this document");
        await tap(p, /^Delete/);
        await dialog(p);
      },
    },
    {
      id: "documents-convert-again",
      note: "Convert again card",
      hash: `#/documents/${DOC}`,
      prep: async (p) => {
        await tap(p, "More actions for this document");
        await tap(p, /^Convert again/);
      },
    },
    {
      id: "documents-drop-veil",
      note: "Files dragged over the documents",
      hash: "#/documents",
      prep: async (p) => {
        await p.evaluate(() => {
          const dt = new DataTransfer();
          dt.items.add(new File(["x"], "spec.docx"));
          document
            .querySelector('[data-testid="documents-screen"]')
            ?.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true }));
        });
      },
    },
    // Generate
    { id: "generate", note: "Generate, the request form", hash: "#/generate" },
    {
      id: "generate-sections",
      note: "Generate › only some sections",
      hash: "#/generate",
      prep: async (p) => {
        await tap(p, /^Only some sections/);
        await p.waitForTimeout(300);
        const unfold = any(p, /^Unfold/);
        if (await unfold.isVisible()) await unfold.click();
      },
    },
    {
      id: "generate-filled",
      note: "Generate with a request typed",
      hash: "#/generate",
      prep: (p) =>
        p.getByRole("textbox", { name: "What should be tested?" }).fill("Manœuvre des sectionneurs avec et sans TK"),
    },
    // Review (before any validation: the queue holds 1420 and the local test)
    { id: "review", note: "Review, first test of the queue", hash: "#/review" },
    { id: "review-to-fix-test", note: "Review of a test marked To fix", hash: `#/review/${TLOCAL}` },
    {
      id: "review-source",
      note: "Review with the source passage open",
      hash: `#/review/${T1420}`,
      prep: async (p) => {
        const chip = step(p, 2)
          .getByRole("button", { name: /Le menu contextuel d'un sectionneur sans TK propose/ })
          .first();
        await chip.click({ timeout: T });
        await p.getByRole("complementary", { name: "Source passage" }).waitFor({ timeout: T });
      },
    },
    {
      id: "review-filter-to-fix",
      note: "Queue filtered on To fix",
      hash: "#/review",
      prep: (p) => tap(p, /^To fix 1/),
    },
    {
      id: "review-sort-menu",
      note: "Sort the queue menu",
      hash: "#/review",
      prep: (p) => p.getByRole("combobox", { name: "Sort the queue" }).click({ timeout: T }),
    },
    {
      id: "review-to-fix-dialog",
      note: "Mark as To fix dialog",
      hash: `#/review/${T1420}`,
      prep: async (p) => {
        await tap(p.getByRole("region", { name: "Test under review" }), /^To fix/);
        await dialog(p, "What needs fixing?");
      },
    },
    {
      id: "review-to-fix-empty-note",
      note: "Mark as To fix submitted without a note",
      hash: `#/review/${T1420}`,
      prep: async (p) => {
        await tap(p.getByRole("region", { name: "Test under review" }), /^To fix/);
        await dialog(p, "What needs fixing?");
        await tap(modal(p).first(), /^Mark To fix/);
      },
    },
    {
      id: "review-edit",
      note: "Review › Edit (the editor inline)",
      hash: `#/review/${T1420}`,
      prep: (p) => tap(p, /^Edit$/),
    },
    {
      id: "review-dock-open",
      note: "Review with the Claude dock open (queue folds)",
      hash: `#/review/${T1420}`,
      prep: async (p) => void (await dock(p)),
    },
    // Tests
    { id: "tests", note: "Tests, no test open", hash: "#/tests" },
    { id: "tests-editor-synced", note: "Editor, a test up to date with Jira", hash: `#/tests/${T1398}` },
    { id: "tests-jira-tab", note: "Tests › Jira tab", hash: "#/tests", prep: (p) => tap(p, /^Jira/) },
    {
      id: "tests-jira-folder",
      note: "Jira tab with a folder open",
      hash: "#/tests",
      prep: async (p) => {
        await tap(p, /^Jira/);
        await tap(p, /^Traction [\d/]+$/);
      },
    },
    {
      id: "tests-filter-nothing",
      note: "Local list, no match",
      hash: "#/tests",
      prep: (p) => p.getByRole("searchbox", { name: "Filter tests" }).fill("zzzqqq"),
    },
    {
      id: "tests-bad-id",
      note: "A test that cannot be opened",
      hash: "#/tests/LFRPS12-0",
      expectErrors: failedWith(400, "the shot opens a test id the project does not have: tests.show refuses it (400)"),
    },
    {
      id: "tests-editor",
      note: "Editor, a test with a modified step, a figure and preconditions",
      hash: `#/tests/${T1420}`,
      prep: (p, s) => openTest(p, s, T1420),
    },
    {
      id: "tests-editor-hidden-details",
      note: "Editor with the Details card folded to its one line",
      hash: `#/tests/${T1420}`,
      prep: async (p, s) => {
        await openTest(p, s, T1420);
        await tap(p.getByRole("region", { name: "Details" }), "Fold the details");
        await p.getByRole("button", { name: "Show the details" }).waitFor({ timeout: T });
      },
    },
    {
      id: "tests-editor-split",
      note: "Editor, step layout Action | Expected",
      hash: `#/tests/${T1420}`,
      prep: (p) => tap(p, /^Action \| Expected/),
    },
    {
      id: "tests-more-menu",
      note: "More actions for this test",
      hash: `#/tests/${T1420}`,
      prep: (p) => tap(p, "More actions for this test"),
    },
    ...(
      [
        ["tests-download-dialog", /^Download from Jira/],
        ["tests-undo-dialog", /^Undo local changes/],
        ["tests-delete-dialog", /^Delete local copy/],
      ] as const
    ).map(
      ([id, item]): Shot => ({
        id,
        note: `Editor › ${String(item).replace(/[/^\\]/g, "")} (confirmation)`,
        hash: `#/tests/${T1420}`,
        prep: async (p) => {
          await tap(p, "More actions for this test");
          await tap(p, item);
          await dialog(p);
        },
      }),
    ),
    {
      id: "tests-columns-dialog",
      note: "Step columns dialog",
      hash: `#/tests/${T1420}`,
      prep: async (p) => {
        await tap(p.getByRole("main"), /^Columns/);
        await dialog(p, "Step columns");
      },
    },
    {
      id: "tests-jira-version",
      note: "A modified step with its Jira version open",
      hash: `#/tests/${T1420}`,
      prep: async (p) => {
        await tap(p.getByRole("main"), "Jira version");
        await p
          .getByRole("region", { name: /as Jira has it/ })
          .first()
          .waitFor({ timeout: T });
      },
    },
    {
      id: "tests-lightbox",
      note: "Screenshot lightbox",
      hash: `#/tests/${T1420}`,
      prep: async (p) => {
        await step(p, 1).getByRole("img", { name: "fig-40.png" }).click({ timeout: T });
        await dialog(p, "fig-40.png");
      },
    },
    {
      id: "tests-passage",
      note: "Source passage dialog from a step",
      hash: `#/tests/${T1420}`,
      prep: async (p) => {
        await step(p, 2)
          .getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6/ })
          .first()
          .click({ timeout: T });
        await dialog(p);
      },
    },
    {
      id: "tests-push-plan",
      note: "Push plan dialog",
      hash: `#/tests/${T1420}`,
      prep: async (p) => {
        await tap(p, "Push to Jira");
        await dialog(p, /^(Push plan|Push .* to Jira\?)$/);
        await p.waitForTimeout(1500);
      },
    },
    {
      id: "tests-dock-test",
      note: "Claude dock on this test",
      hash: `#/tests/${T1420}`,
      prep: async (p) => void (await dock(p)),
    },
    {
      id: "tests-dock-answer",
      note: "Claude dock after a question",
      hash: `#/tests/${T1420}`,
      prep: (p) => ask(p, "Ajoute le cas négatif"),
    },
    {
      id: "tests-new-empty-steps",
      note: "A new test with no step",
      hash: "#/tests",
      prep: async (p) => {
        await tap(p, "New test");
        await step(p, 1).waitFor({ timeout: T });
        await tap(p, "Delete step 1");
        await see(p, "This test has no steps yet");
        await p.getByRole("textbox", { name: "Summary" }).focus();
      },
    },
    // Palette and shell with data
    {
      id: "palette-query",
      note: "Search everywhere with results",
      hash: "#/tests",
      prep: (p) => palette(p, "sectionneur"),
    },
    ...["Tests", "Documents", "Passages", "Commands"].map(
      (tab): Shot => ({
        id: `palette-${tab.toLowerCase()}`,
        note: `Search everywhere › ${tab}`,
        hash: "#/tests",
        prep: async (p) => {
          await palette(p, tab === "Commands" ? "docs" : tab === "Documents" ? "Traction" : "sectionneur");
          await p
            .getByRole("tablist", { name: "Search in" })
            .getByRole("tab", { name: new RegExp(`^${tab}`) })
            .click({ timeout: T });
          await p.waitForTimeout(600);
        },
      }),
    ),
    {
      id: "command-form",
      note: "A command's form (from the palette)",
      hash: "#/tests",
      prep: async (p) => {
        await palette(p, "docs.show");
        await p.getByRole("option").first().click({ timeout: T });
        await dialog(p);
      },
    },
    {
      id: "toast-ok",
      note: "A success toast",
      hash: "#/tests",
      prep: async (p) => {
        await palette(p, "system.version");
        await p.keyboard.press("Enter");
        await p.getByRole("status").filter({ hasText: /done/ }).first().waitFor({ timeout: T });
      },
    },
    {
      id: "toast-error",
      note: "An error toast: a command run from the palette fails",
      expectErrors: failedWith(500, "the shot makes system.version fail (500) to show the error toast of an action"),
      hash: "#/tests",
      prep: async (p) => {
        await fail(p, "**/api/system/version");
        await palette(p, "system.version");
        await p.keyboard.press("Enter");
        await p
          .getByText(/— failed$/)
          .first()
          .waitFor({ timeout: T });
      },
    },
    {
      id: "open-by-key-dialog",
      note: "Open a project by its Jira key",
      hash: "#/setup/project",
      setup: true,
      ready: heading1,
      prep: async (p) => {
        await tap(p, /^Open by Jira key/);
        await dialog(p);
      },
    },
    {
      id: "dock-docs",
      note: "Claude dock on the documents",
      hash: `#/documents/${DOC}`,
      prep: async (p) => void (await dock(p)),
    },
    {
      id: "dock-docs-answer",
      note: "Claude dock, an answer about the documents",
      hash: `#/documents/${DOC}`,
      prep: (p) => ask(p, "Que fait le menu contextuel d'un sectionneur ?"),
    },
    {
      id: "dock-actions",
      note: "Claude dock › Actions",
      hash: "#/documents",
      prep: async (p) => {
        const d = await dock(p);
        await tap(d, /^Actions/);
      },
    },
    {
      id: "dock-import-contexts",
      note: "Saved contexts (import into the dock)",
      hash: "#/documents",
      prep: async (p) => {
        const d = await dock(p);
        await tap(d, "Add context");
        await p.getByRole("menu").first().waitFor({ timeout: T });
      },
    },
    {
      id: "contexts-dialog",
      note: "Contexts manager",
      hash: "#/settings/claude-contexts",
      prep: async (p) => {
        await tap(p, /^Manage contexts/);
        await dialog(p, "Contexts");
      },
    },
    ...settingsShots(),
    {
      id: "settings-columns-claude",
      note: "Smart columns › Claude's proposals",
      hash: "#/settings/columns",
      prep: async (p) => {
        await tap(p.getByRole("region", { name: "Ask Claude about the columns" }), "Ask Claude");
        await p.getByRole("list", { name: "Claude's proposals" }).waitFor({ timeout: 30_000 });
      },
    },
    {
      id: "settings-models-catalog",
      note: "Models › catalog unfolded",
      hash: "#/settings/models",
      prep: (p) => tap(p, /^Model catalog/),
    },
    {
      id: "settings-models-folder",
      note: "Models folder dialog",
      hash: "#/settings/models",
      prep: async (p) => {
        await tap(p, /^(Change|Choose)…/);
        await dialog(p, /models folder|Where should models be stored/i);
      },
    },
    {
      id: "settings-models-pack-dialog",
      note: "Use a pack (plan dialog)",
      hash: "#/settings/models",
      prep: async (p) => {
        await pickPack(p, "Performance");
        await dialog(p);
      },
    },
    {
      id: "settings-models-measure",
      note: "Measure a pack",
      hash: "#/settings/models",
      prep: async (p) => {
        await tap(p.getByRole("article", { name: "Light pack" }), /^Measure/);
        await dialog(p);
      },
    },
    {
      id: "settings-search-try",
      note: "Search settings being edited, Try it with each passage's why",
      hash: "#/settings/search",
      prep: async (p) => {
        await p.getByRole("radio", { name: "Meaning" }).click();
        await p.getByRole("searchbox", { name: "Try a search" }).fill("ouverture sectionneur TK");
        await p.getByRole("list", { name: "Passages found" }).getByRole("listitem").first().waitFor();
        await p.getByRole("heading", { name: "Try it" }).scrollIntoViewIfNeeded();
      },
    },
    {
      id: "settings-search-drop",
      note: "Drop a vector space (confirmation)",
      hash: "#/settings/search",
      prep: async (p) => {
        await tap(p, /^Drop space/);
        await dialog(p);
      },
    },
    ...shellShots().filter((s) => s.id !== "palette-empty" && s.id !== "dock-open"),
    // Loading and error states, made by holding or failing the API
    {
      id: "loading-tests",
      note: "Test loading",
      hash: "#/tests",
      prep: async (p) => {
        await delay(p, "**/api/tests/show", 60_000);
        await p.goto(`${new URL(p.url()).origin}/#/tests/${T1398}`);
        await p.waitForTimeout(800);
      },
    },
    {
      id: "loading-documents",
      note: "Documents loading",
      hash: "#/tests",
      prep: async (p) => {
        await delay(p, "**/api/docs/**", 60_000);
        await p.goto(`${new URL(p.url()).origin}/#/documents`);
        await p.waitForTimeout(800);
      },
    },
    {
      id: "loading-jobs",
      note: "Jobs loading",
      hash: "#/tests",
      prep: async (p) => {
        await delay(p, "**/api/jobs/list", 60_000);
        const origin = new URL(p.url()).origin;
        await p.goto("about:blank");
        await p.goto(`${origin}/#/jobs`);
        await p.waitForTimeout(800);
      },
    },
    {
      id: "loading-doctor",
      note: "System check running",
      hash: "#/tests",
      prep: async (p) => {
        await delay(p, "**/api/system/doctor", 60_000);
        const origin = new URL(p.url()).origin;
        await p.goto("about:blank");
        await p.goto(`${origin}/#/doctor`);
        await p.waitForTimeout(800);
      },
    },
    {
      id: "error-document",
      note: "A document that cannot be opened",
      expectErrors: failedWith(500, "the shot makes docs.show fail (500) to show the document's error state"),
      hash: "#/tests",
      prep: async (p) => {
        await fail(p, "**/api/docs/show");
        await p.goto(`${new URL(p.url()).origin}/#/documents/${DOC}`);
        await see(p, /could not be opened/);
      },
    },
    {
      id: "error-models",
      note: "Models that cannot be read",
      expectErrors: failedWith(500, "the shot makes every models.* read fail (500) to show the error state"),
      hash: "#/tests",
      prep: async (p) => {
        await fail(p, "**/api/models/**");
        await p.goto(`${new URL(p.url()).origin}/#/settings/models`);
        await see(p, /could not be read/);
      },
    },
    // Last, because they change the project: generation, then the jobs it leaves
    {
      id: "generate-replace-dialog",
      note: "Delete the tests not validated yet? (before generating)",
      hash: "#/generate",
      prep: async (p) => {
        await p.getByRole("textbox", { name: "What should be tested?" }).fill("Manœuvre des sectionneurs");
        await tap(p.getByRole("region", { name: "Request" }), /^Generate/);
        await dialog(p);
      },
    },
    {
      id: "generate-done",
      note: "Generate › tests written",
      hash: "#/generate",
      prep: async (p) => {
        await generate(p);
        await p
          .getByText(/^\d+ tests? written$/)
          .first()
          .waitFor({ timeout: 90_000 });
      },
      settle: 1000,
    },
    {
      id: "generate-not-written",
      note: "Generate › the tests not written, grouped by Claude's category",
      hash: "#/generate",
      prep: async (p) => {
        await tap(p.getByRole("region", { name: "Result" }), /^Not written · \d+$/);
        await p.getByRole("region", { name: "Not written" }).waitFor({ timeout: T });
      },
    },
    {
      id: "dock-actions-by-target",
      note: "Claude dock › Actions grouped by what they work on (after a generation: its tests, the generation)",
      hash: "#/generate",
      prep: async (p) => {
        const dock = p.getByRole("complementary", { name: "Claude" });
        const rail = dock.getByRole("button", { name: "Open Claude" });
        if (await rail.isVisible()) await rail.click();
        await tap(dock, /^Actions/);
        await dock
          .getByRole("region", { name: /^Generation · / })
          .first()
          .waitFor({ timeout: T });
      },
    },
    {
      id: "review-sources-read",
      note: "Source panel › Sources read unfolded (a freshly generated test)",
      hash: "#/review",
      prep: async (p) => {
        await openGenerated(p);
        const expand = step(p, 2).getByRole("button", { name: "Expand step 2" });
        if (await expand.isVisible()) await expand.click();
        await step(p, 2)
          .getByRole("button", { name: /La fenêtre Propriétés affiche/ })
          .first()
          .click({ timeout: T });
        await tap(p.getByRole("complementary", { name: "Source passage" }), /^Sources read/);
      },
    },
    { id: "review-after-generate", note: "Review of a freshly generated test", hash: "#/review", prep: openGenerated },
    {
      id: "review-misplaced-quote",
      note: "Source panel: the quote is not at this anchor",
      hash: "#/review",
      prep: async (p) => {
        await openGenerated(p);
        await step(p, 2)
          .getByRole("button", { name: /§5\.6\.7/ })
          .first()
          .click({ timeout: T });
        await p.getByRole("complementary", { name: "Source passage" }).waitFor({ timeout: T });
      },
    },
    // Run (the testers' screen)
    { id: "run-list", note: "Run, the runs and the first one in progress", hash: "#/run" },
    {
      id: "run-problems",
      note: "Run › only the tests with a problem",
      hash: `#/run/${RUN}`,
      prep: (p) => tap(p, /^Problems/),
    },
    { id: "run-test", note: "Run › running a test with a NOK step and a question", hash: `#/run/${RUN}%2F${TLOCAL}` },
    { id: "run-test-picture", note: "Run › a test whose step shows a figure", hash: `#/run/${RUN}%2F${T1420}` },
    {
      id: "run-test-blocked",
      note: "Run › a test set Blocked, its reason asked",
      hash: `#/run/${RUN}%2F${T1398}`,
      prep: (p) => tap(p, /^Blocked/),
    },
    {
      id: "run-export",
      note: "Run › Export as pages…",
      hash: `#/run/${RUN}`,
      prep: async (p) => {
        await tap(p, "Export as pages…");
        await p.getByRole("textbox", { name: "Folder" }).fill(join(tmpdir(), "testimus-screens", RUN));
      },
    },
    {
      id: "run-import",
      note: "Run › Import results… with its plan (the pages of the run, exported just before)",
      hash: `#/run/${RUN}`,
      prep: async (p, s) => {
        const dir = mkdtempSync(join(tmpdir(), "testimus-screens-pages-"));
        await s.api("runs.export", { run: RUN, dir: join(dir, RUN) });
        await tap(p, "Import results…");
        await p.getByRole("textbox", { name: "Folder or run.json" }).fill(join(dir, RUN));
        await see(p, /^Into «/);
      },
    },
    {
      id: "run-new",
      note: "Run › New run…",
      hash: "#/run",
      prep: async (p) => {
        await tap(p, "New run…");
        await dialog(p, "New run");
        await p.getByRole("textbox", { name: "Name" }).fill("Recette J6 — Disjoncteurs");
        await see(p, /^3 tests:/);
      },
    },
    { id: "jobs", note: "Jobs, first job open", hash: "#/jobs" },
    {
      id: "jobs-claude",
      note: "Jobs › a job's Claude processes unfolded",
      hash: "#/jobs",
      prep: async (p) => {
        await p
          .getByRole("region", { name: "Job list" })
          .locator('[role="treeitem"][aria-expanded="false"]')
          .first()
          .press("ArrowRight", { timeout: T });
      },
    },
    {
      id: "tests-list-review-waiting",
      note: "Local list after a generation (tests waiting for review)",
      hash: "#/tests",
    },
  ];
}

function emptyShots(): Shot[] {
  return [
    { id: "documents", note: "No document yet", hash: "#/documents" },
    { id: "generate", note: "Generate with no document", hash: "#/generate" },
    { id: "tests", note: "No test yet", hash: "#/tests" },
    {
      id: "tests-jira-tab",
      note: "Jira tab of a project not connected to Jira",
      hash: "#/tests",
      prep: (p) => tap(p, /^Jira/),
    },
    { id: "review", note: "Nothing to review", hash: "#/review" },
    { id: "run-empty", note: "No run yet", hash: "#/run" },
    { id: "jobs", note: "No job yet", hash: "#/jobs" },
    ...settingsShots(),
    ...shellShots(),
  ];
}

function noneShots(): Shot[] {
  const setup = (id: string, note: string, hash: string): Shot => ({ id, note, hash, setup: true, ready: heading1 });
  return [
    setup("setup-welcome", "First run › Welcome, how you will work and the theme", "#/setup"),
    setup("setup-claude", "First run › Claude found and its sign-in proved", "#/setup/claude"),
    setup("setup-access", "First run › Jira and Xray, the access found tested on arrival", "#/setup/access"),
    {
      id: "setup-access-form",
      note: "First run › the access form, unfolded",
      hash: "#/setup/access",
      setup: true,
      ready: heading1,
      prep: async (p) => {
        await tap(p, "Change the access");
        await p.getByRole("textbox", { name: "Jira site" }).waitFor({ timeout: T });
      },
    },
    setup("setup-project", "First run › Choose a project", "#/setup/project"),
    setup("setup-pack-no-project", "First run › Search pack, no project yet", "#/setup/pack"),
    setup("setup-ready", "First run › Ready, what is set and what was left for later", "#/setup/ready"),
    { id: "tests", note: "Tests with no project", hash: "#/tests" },
    { id: "settings-project", note: "Settings with no project", hash: "#/settings/project" },
    { id: "settings-access", note: "Settings › Access with no project", hash: "#/settings/access" },
    { id: "palette", note: "Palette with no project (commands only)", hash: "#/tests", prep: (p) => palette(p) },
    { id: "doctor", note: "System check with no project", hash: "#/doctor", settle: 2500 },
  ];
}

function twoProjectsShots(): Shot[] {
  return [
    { id: "project-menu", note: "Project menu with two projects", hash: "#/tests", prep: (p) => tap(p, /^Project /) },
    {
      id: "setup-project-known",
      note: "Choose a project, two known",
      hash: "#/setup/project",
      setup: true,
      ready: heading1,
    },
    {
      id: "setup-project-more",
      note: "More actions on a known project",
      hash: "#/setup/project",
      setup: true,
      ready: heading1,
      prep: (p) => tap(p, /^More actions for /),
    },
    {
      id: "setup-pack",
      note: "First run › Choose how documents are searched",
      hash: "#/setup/pack",
      setup: true,
      ready: heading1,
    },
    {
      id: "setup-pack-analysed",
      note: "Search pack step, machine analysed",
      hash: "#/setup/pack",
      setup: true,
      ready: heading1,
      prep: async (p) => {
        await tap(p, /^Analyse (my machine|again)/);
        await p.waitForTimeout(1500);
      },
    },
  ];
}

function slowShots(): Shot[] {
  return [
    {
      id: "generate-running",
      note: "Generate › Claude is writing",
      hash: "#/generate",
      prep: async (p) => {
        await generate(p);
        await see(p, "Claude is writing");
      },
    },
    {
      id: "activity-popover",
      note: "Running jobs popover",
      hash: "#/documents",
      prep: async (p) => tap(p, /\d+ jobs? running/),
    },
    { id: "jobs-running", note: "A running job with its live log", hash: "#/jobs", settle: 1500 },
    {
      id: "dock-running",
      note: "Claude dock while Claude runs",
      hash: `#/documents/${DOC}`,
      prep: async (p) => {
        const d = await dock(p);
        await d.getByRole("textbox").first().fill("Résume le §5.6.6");
        await tap(d, /^(Send|Ask)$/);
        await p.waitForTimeout(1500);
      },
    },
    {
      id: "tests-claude-working",
      note: "Editor while Claude works on the test",
      hash: `#/tests/${T1398}`,
      prep: async (p) => {
        const d = await dock(p);
        await d.getByRole("textbox").first().fill("Ajoute le cas négatif");
        await tap(d, "Send");
        await p.waitForTimeout(1500);
      },
    },
    {
      id: "tests-pull",
      note: "Pull pane (a Jira test being downloaded)",
      hash: "#/tests",
      prep: async (p) => {
        // ponytail: the pull answers in 1.5 s and every size and theme is shot after it — held, the pane stays drawn
        await delay(p, "**/api/xray/pull", 60_000);
        await tap(p, /^Jira/);
        await tap(p, /^Traction [\d/]+$/);
        await tap(p, /^Disjoncteurs [\d/]+$/);
        await tap(p, /LFRPS12-1401/);
        await see(p, /^LFRPS12-1401 · (pulling from Jira|queued)/);
      },
    },
    {
      id: "tests-pushing",
      note: "Pushing to Jira",
      hash: `#/tests/${T1398}`,
      prep: async (p, s) => {
        // ponytail: the earlier shots left 60 s Claude runs going, and a Claude run locks the editor and Push
        for (const j of (await s.api<{ id: string }[]>("jobs.list", { running: true })) ?? [])
          await s.api("jobs.cancel", { id: j.id }).catch(() => {});
        await openTest(p, s, T1420);
        await tap(p, "Push to Jira");
        await dialog(p, /^(Push plan|Push .* to Jira\?)$/);
        await tap(p, "Confirm push");
        await dialog(p, /^Pushing .* to Jira$/);
        await p.waitForTimeout(800);
      },
    },
  ];
}

// ponytail: Claude absent shows at once; Claude installed but signed out is known only once something asks it — a run,
// or the system check's sign-in probe (claude.status signIn) — so the logged-out shots ask
function claudeOfflineShots(signIn = false): Shot[] {
  return [
    {
      id: "dock",
      note: "Claude dock, Claude offline",
      hash: "#/documents",
      prep: async (p) => (signIn ? ask(p, "reply ok") : void (await dock(p))),
    },
    {
      id: "generate",
      note: "Generate with Claude offline",
      hash: "#/generate",
      prep: signIn
        ? async (p) => {
            await generate(p);
            await p.waitForTimeout(2500);
          }
        : undefined,
    },
    { id: "settings-claude", note: "Settings › Claude with Claude offline", hash: "#/settings/claude" },
    {
      id: "doctor",
      note: "System check with Claude offline",
      hash: "#/doctor",
      settle: 2500,
      prep: signIn
        ? async (p) => {
            await tap(p, "Check Claude sign-in");
            await p.waitForTimeout(2500);
          }
        : undefined,
    },
  ];
}

function modelsShots(fit?: string): Shot[] {
  const shots: Shot[] = [
    { id: "settings-models", note: "Settings › Models", hash: "#/settings/models" },
    { id: "settings-search", note: "Settings › Search", hash: "#/settings/search" },
    {
      id: "setup-pack",
      note: "Search pack step, this machine analysed",
      hash: "#/setup/pack",
      setup: true,
      ready: heading1,
      prep: async (p) => {
        await tap(p, /^Analyse (my machine|again)/);
        await p.waitForTimeout(1500);
      },
    },
  ];
  if (fit)
    shots.push({
      id: "settings-models-fit",
      note: `Will the ${fit} pack fit?`,
      hash: "#/settings/models",
      prep: async (p) => {
        await pickPack(p, fit);
        await dialog(p);
      },
    });
  return shots;
}

function essaiShots(): Shot[] {
  return [
    { id: "documents", note: "Documents of the real project", hash: "#/documents" },
    {
      id: "documents-figures",
      note: "Figures of the real project",
      hash: "#/documents",
      prep: (p) => tap(p, /^Figures/),
    },
    { id: "generate", note: "Generate on the real project", hash: "#/generate" },
    { id: "review", note: "Review of a real generated test", hash: "#/review" },
    {
      id: "review-second",
      note: "Review of the second test",
      hash: "#/review",
      prep: async (p) => {
        await p.keyboard.press("j");
        await p.waitForTimeout(600);
      },
    },
    {
      id: "tests-editor",
      note: "Editor on a real test",
      hash: "#/tests",
      prep: async (p, s) => {
        await openTest(p, s, await firstId(s, "tests.list"));
      },
    },
    { id: "tests-jira-tab", note: "Jira tab (fake Jira)", hash: "#/tests", prep: (p) => tap(p, /^Jira/) },
    {
      id: "palette-query",
      note: "Search everywhere on the real project",
      hash: "#/tests",
      prep: (p) => palette(p, "queue"),
    },
    { id: "jobs", note: "Jobs of the real project", hash: "#/jobs" },
    { id: "settings-columns", note: "Smart columns of the real project", hash: "#/settings/columns" },
    {
      id: "dock-docs-answer",
      note: "Claude dock, an answer about the documents",
      hash: "#/documents",
      prep: (p) => ask(p, "Comment fonctionnent les files d'attente ?"),
    },
  ];
}

// ponytail: what a core that stopped on a locked index leaves in the log — the 40 lines the error page shows
const CORE_FAILED = [
  "09:14:01.960 [desktop] single instance lock acquired",
  "09:14:01.988 [desktop] profile %APPDATA%\\Testimus\\desktop",
  "09:14:02.004 [desktop] splash shown",
  "09:14:02.051 [desktop] node: C:\\Program Files\\Testimus\\node\\node.exe (v26.12.1)",
  "09:14:02.077 [desktop] port 4317 free · reusing it",
  "09:14:02.098 [desktop] spawning the core",
  "09:14:02.410 [core] TESTIMUS_SHELL desktop/0.1.0",
  "09:14:02.118 [desktop] Testimus 0.1.0 (desktop) · Electron 45.2.1 · win32 x64",
  "09:14:02.121 [desktop] window: 1366×768 at 120,64 · zoom 100 % · last port 4317",
  "09:14:02.130 [desktop] core: C:\\Program Files\\Testimus\\node\\node.exe app\\testimus.mjs serve --port 4317 --port-fallback --no-open --ready-json --exit-with-stdin",
  "09:14:02.131 [desktop] env: TESTIMUS_SHELL=desktop/0.1.0 NODE_USE_ENV_PROXY=1 TESTIMUS_HOME_BIN=C:\\Program Files\\Testimus\\bin",
  "09:14:02.402 [core] Testimus 0.1.0 · Node v26.12.1 · win32 x64",
  "09:14:02.405 [core] home C:\\Users\\tester\\AppData\\Roaming\\Testimus",
  "09:14:02.405 [core] data C:\\Users\\tester\\AppData\\Local\\Testimus",
  "09:14:02.406 [core] proxy: none (direct connection)",
  "09:14:02.411 [core] settings.json read · ui keys 14",
  "09:14:02.418 [core] models: registry C:\\Users\\tester\\AppData\\Roaming\\Testimus\\models.json · folder D:\\Testimus\\models",
  "09:14:02.421 [core] models: 3 installed · llama.cpp b6120",
  "09:14:02.433 [core] project: C:\\Users\\tester\\Testimus\\Projects\\LFRPS12 (last opened)",
  "09:14:02.436 [core] project: RATP Sosie · LFRPS12 · fr",
  "09:14:02.440 [core] jobs: 0 running, 2 finished kept",
  "09:14:02.447 [core] index: opening C:\\Users\\tester\\Testimus\\Projects\\LFRPS12\\index\\rag.sqlite",
  "09:14:02.452 [core] index: sqlite 3.54.0 · loading sqlite-vec 0.1.9",
  "09:14:07.459 [core] Error: SQLITE_BUSY: database is locked",
  "09:14:07.459 [core]     at DatabaseSync.exec (node:sqlite:412:18)",
  "09:14:07.459 [core]     at openIndex (file:///C:/Program Files/Testimus/app/testimus.mjs:48211:12)",
  "09:14:07.459 [core]     at activeSpace (file:///C:/Program Files/Testimus/app/testimus.mjs:48390:21)",
  "09:14:07.460 [core]     at ragStatus (file:///C:/Program Files/Testimus/app/testimus.mjs:49102:17)",
  "09:14:07.460 [core]     at warmProject (file:///C:/Program Files/Testimus/app/testimus.mjs:61877:9)",
  "09:14:07.460 [core]     at serve (file:///C:/Program Files/Testimus/app/testimus.mjs:70154:5)",
  "09:14:07.460 [core]     at async main (file:///C:/Program Files/Testimus/app/testimus.mjs:71020:3) {",
  "09:14:07.460 [core]   code: 'ERR_SQLITE_ERROR',",
  "09:14:07.460 [core]   errcode: 5,",
  "09:14:07.460 [core]   errstr: 'database is locked'",
  "09:14:07.460 [core] }",
  "09:14:07.461 [core] hint: another Testimus (browser mode, port 4318) may hold the index of this project",
  "09:14:07.463 [core] shutdown: closing 0 jobs, 0 children",
  "09:14:07.470 [core] exit code 1",
  "09:14:07.471 [desktop] core exited before the ready line (code 1, after 5.3 s)",
  "09:14:07.471 [desktop] showing the error page · log C:\\Users\\tester\\AppData\\Local\\Testimus\\logs\\desktop-2026-11-03.log",
];

function desktopShots(): Shot[] {
  const pages = join(ROOT, "dist", "desktop", "pages");
  return [
    {
      id: "splash",
      note: "Desktop shell › starting",
      page: async (p) => {
        await p.goto(pathToFileURL(join(pages, "splash.html")).href);
      },
    },
    {
      id: "error",
      note: "Desktop shell › the core stopped",
      page: async (p) => {
        await p.addInitScript((lines: string[]) => {
          (window as unknown as { testimusShell: unknown }).testimusShell = {
            details: async () => ({
              message: "The core of Testimus stopped before it was ready (exit code 1).",
              lines,
              logDir: "C:\\Users\\tester\\AppData\\Local\\Testimus\\logs",
            }),
            restart: async () => {},
            openLogs: async () => {},
          };
        }, CORE_FAILED);
        await p.goto(pathToFileURL(join(pages, "error.html")).href);
        await p.waitForTimeout(400);
      },
    },
  ];
}

export function SCENARIOS(essai: string): Scenario[] {
  return [
    { id: "none", note: "No project at all: the first run", env: { TESTIMUS_MOCK_SEED: "none" }, shots: noneShots() },
    {
      id: "empty",
      note: "A project with no document, no test, no Jira key",
      env: { TESTIMUS_MOCK_SEED: "empty" },
      shots: emptyShots(),
    },
    {
      id: "fixture",
      note: "The LFRPS12 sample project with the fake Jira (every state with data)",
      env: { TESTIMUS_MOCK_SEED: "fixture" },
      shots: fixtureShots(),
    },
    {
      id: "kit",
      note: "The component catalogue (#/kit): every kit component in each of its states, light and dark",
      env: { TESTIMUS_MOCK_SEED: "fixture" },
      shots: kitShots(),
    },
    {
      id: "two-projects",
      note: "Two known projects (project menu and project step)",
      env: { TESTIMUS_MOCK_SEED: "fixture,empty" },
      shots: twoProjectsShots(),
    },
    {
      id: "slow",
      note: "The sample project with Claude and Jira slowed down: running states",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_CLAUDE_MS: "60000", TESTIMUS_MOCK_JIRA_MS: "1500" },
      shots: slowShots(),
    },
    {
      id: "writing",
      note: "Generate while Claude writes, every line of the fake Claude 2.5 s apart",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_CLAUDE_STEP_MS: "2500" },
      shots: [
        {
          id: "generate-writing",
          note: "Generate › the test Claude is writing open, the one before it folded",
          hash: "#/generate",
          prep: async (p) => {
            await generate(p);
            await p
              .getByRole("region", { name: "Tests written" })
              .getByRole("button", { name: /^Sectionneur avec TK/, expanded: true })
              .waitFor({ timeout: 90_000 });
          },
          settle: 300,
        },
      ],
    },
    {
      id: "push-stopped",
      note: "A push stopped by an attachment Jira refuses",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_MAX_ATTACHMENT: "100" },
      shots: [
        {
          id: "tests-push-stopped",
          note: "Push stopped at an operation, with Resume",
          hash: "#/tests",
          prep: async (p, s) => {
            await openTest(p, s, T1420);
            await tap(p.getByRole("complementary", { name: "Tests" }), "Clone");
            await p.waitForURL(/#\/tests\/local-/, { timeout: T });
            await tap(p.getByRole("main"), "Push to Jira");
            await dialog(p, /^(Push plan|Push .* to Jira\?)$/);
            await tap(p, "Confirm push");
            await see(p, /Push stopped/);
          },
        },
      ],
    },
    {
      id: "claude-absent",
      note: "Claude Code not installed",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_CLAUDE: "absent" },
      shots: claudeOfflineShots(),
    },
    {
      id: "claude-logged-out",
      note: "Claude Code not signed in",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_CLAUDE: "logged-out" },
      shots: claudeOfflineShots(true),
    },
    {
      id: "words-only",
      note: "An index without vectors (search on words only)",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_INDEX: "bm25" },
      shots: [
        { id: "documents", note: "Documents › Search on words only", hash: "#/documents" },
        { id: "settings-search", note: "Settings › Search, words only", hash: "#/settings/search" },
        {
          id: "palette-query",
          note: "Search everywhere, words only",
          hash: "#/tests",
          prep: (p) => palette(p, "sectionneur"),
        },
      ],
    },
    {
      id: "indexing",
      note: "An index run under way on an index without vectors (no index warning while it goes)",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_INDEX: "bm25", TESTIMUS_MOCK_INDEX_MS: "600000" },
      shots: [
        {
          id: "documents",
          note: "Documents while indexing: Indexing · n %, Waiting to index, the run's bar",
          hash: "#/documents",
          prep: (p, s) => indexing(p, s),
        },
        {
          id: "settings-search",
          note: "Settings › Search while indexing",
          hash: "#/settings/search",
          prep: (p, s) => indexing(p, s),
        },
        {
          id: "generate",
          note: "Generate waits for the index run",
          hash: "#/generate",
          prep: (p, s) => indexing(p, s),
        },
      ],
    },
    {
      id: "import-folder",
      note: "Import a folder: the files found, the documents ticked, the files left aside with their reason",
      env: { TESTIMUS_MOCK_SEED: "fixture" },
      shots: [
        {
          id: "documents-import-folder",
          note: "Documents › Import a folder… once the folder is read (a browser types its path)",
          hash: "#/documents",
          prep: async (p) => {
            await tap(p, "Import a folder…");
            await dialog(p, "Import a folder");
            await p.getByRole("textbox", { name: "Folder" }).fill(clientFolder());
            await tap(p, "Read the folder");
            await see(p, /can be imported/);
          },
        },
      ],
    },
    {
      id: "converting",
      note: "Four documents imported together: two convert at once, two wait their turn, then one index run",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_CLAUDE_MS: "600000" },
      before: async (s) => {
        await s.api("system.set", { agentsMax: 2, agentsAdaptive: false });
        const dir = mkdtempSync(join(tmpdir(), "testimus-screens-many-"));
        for (const n of ["Traction", "Signalisation", "Energie", "Freinage"])
          writeFileSync(join(dir, `SPEC_${n}_01_00.docx`), sampleDocx());
        await s.api("docs.addFolder", { dir });
      },
      shots: [
        {
          id: "documents",
          note: "Documents while several conversions go: Converting on two rows, Waiting to convert on two",
          hash: "#/documents",
          prep: (p) => see(p, /Converting 2 at a time/),
        },
      ],
    },
    {
      id: "loading-slow",
      note: "Reads that take long (TESTIMUS_MOCK_READ_MS): the skeleton's loading line, then « answering slowly »",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_READ_MS: "tests.list=600000,docs.list=600000" },
      shots: [
        {
          id: "tests-status",
          note: "Tests after a second: Loading the tests… and the seconds under the skeleton",
          sizes: ["lg"],
          page: async (p, s) => {
            await p.goto(`${s.url}/#/tests`);
            await see(p, /^Loading the tests… \d s$/);
          },
        },
        {
          id: "tests-slow",
          note: "Tests after 10 s: Still loading, Testimus is answering slowly, Try again",
          page: async (p, s) => {
            await p.goto(`${s.url}/#/tests`);
            await see(p, "Testimus is answering slowly. The page keeps waiting.");
          },
        },
        {
          id: "documents-slow",
          note: "Documents after 10 s: one line for the list and the document pane waiting on the same read",
          page: async (p, s) => {
            await p.goto(`${s.url}/#/documents`);
            await see(p, "Testimus is answering slowly. The page keeps waiting.");
          },
        },
      ],
    },
    {
      id: "machine-small-gpu",
      note: "A PC with a 4 GB GPU",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_MACHINE: "gpu-small" },
      shots: modelsShots("Quality"),
    },
    {
      id: "machine-cpu-only",
      note: "A PC with no GPU",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_MACHINE: "cpu-only" },
      shots: modelsShots("Balanced"),
    },
    {
      id: "machine-mac",
      note: "A Mac (arm64)",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_MACHINE: "mac" },
      shots: modelsShots(),
    },
    {
      id: "models-no-folder",
      note: "No models folder chosen yet, no llama.cpp",
      env: {
        TESTIMUS_MOCK_SEED: "fixture",
        TESTIMUS_MOCK_MODELS_DIR: "unset",
        TESTIMUS_MOCK_LLAMACPP: "absent",
        TESTIMUS_MOCK_ADVICE: "downgrade",
      },
      shots: [
        ...modelsShots(),
        {
          id: "settings-models-folder-first",
          note: "The first download asks for a folder",
          hash: "#/settings/models",
          prep: async (p) => {
            await pickPack(p, "Performance");
            await p.waitForTimeout(500);
            const go = p
              .getByRole("dialog")
              .getByRole("button", { name: /^(Download|Use)/ })
              .first();
            if (await go.isVisible().catch(() => false)) await go.click();
            await dialog(p, /models folder|Where should models be stored/i);
          },
        },
      ],
    },
    {
      id: "advice-offload",
      note: "Models advice: partly on the processor",
      env: { TESTIMUS_MOCK_SEED: "fixture", TESTIMUS_MOCK_ADVICE: "offload" },
      shots: [modelsShots()[0]],
    },
    {
      id: "doc-images",
      note: "Images as documents: the fixture's images document, a text document, the choice when images are added",
      env: { TESTIMUS_MOCK_SEED: "fixture" },
      shots: imageShots(),
    },
    {
      id: "docs-overview",
      note: "How the documents fit together: written by Claude, updated after a change, shown, compared, edited, its option",
      env: { TESTIMUS_MOCK_SEED: "fixture" },
      before: overviewWritten,
      shots: overviewShots(),
    },
    {
      id: "doc-video",
      note: "A video as a document: the fixture's video, its transcript and key frames",
      env: { TESTIMUS_MOCK_SEED: "fixture" },
      shots: videoShots(),
    },
    {
      id: "essai",
      note: "A copy of the Essai project of this PC (not production) with the fake Jira",
      env: { TESTIMUS_MOCK_SEED: `${essai},fixture` },
      skip: existsSync(essai) ? undefined : `no essai project at ${essai} — pass --essai <dir>`,
      before: async (s) => {
        await s.api("project.set", { jiraProject: "LFRPS12" }).catch(() => {});
      },
      shots: essaiShots(),
    },
    {
      id: "desktop",
      note: "The desktop shell's own pages (splash, core stopped)",
      env: {},
      noServer: true,
      before: async () => {
        const b = spawnSync(process.execPath, [join(ROOT, "scripts", "desktop.ts"), "--build-only"], {
          cwd: ROOT,
          stdio: "inherit",
        });
        if (b.status !== 0) throw new Error("desktop:build failed");
      },
      shots: desktopShots(),
    },
  ];
}
