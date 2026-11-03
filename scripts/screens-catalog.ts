import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Locator, Page } from "@playwright/test";

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
};

export type Scenario = {
  id: string;
  note: string;
  env: Record<string, string>;
  noServer?: boolean;
  before?: (s: Server) => Promise<void>;
  shots: Shot[];
};

const ROOT = join(import.meta.dirname, "..");
const T = 15_000;

function any(page: Page | Locator, name: string | RegExp): Locator {
  const by = (role: Parameters<Page["getByRole"]>[0]) => page.getByRole(role, { name });
  return by("button")
    .or(by("tab"))
    .or(by("radio"))
    .or(by("menuitem"))
    .or(by("menuitemradio"))
    .or(by("link"))
    .or(by("option"))
    .first();
}

async function tap(page: Page | Locator, name: string | RegExp): Promise<void> {
  const el = any(page, name);
  await el.waitFor({ timeout: T });
  await el.click();
}

const dialog = (page: Page, name?: string | RegExp) =>
  (name ? page.getByRole("dialog", { name }) : page.getByRole("dialog")).first().waitFor({ timeout: T });

const see = (page: Page, text: string | RegExp) => page.getByText(text).first().waitFor({ timeout: T });

async function palette(page: Page, query?: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await dialog(page, "Search everywhere");
  if (query) {
    await page.getByRole("combobox", { name: "Search" }).fill(query);
    await page.waitForTimeout(800);
  }
}

async function dock(page: Page): Promise<Locator> {
  const d = page.getByRole("complementary", { name: "Claude" });
  await tap(d, "Open Claude");
  await d.getByRole("heading", { name: "Ask Claude" }).waitFor({ timeout: T });
  return d;
}

async function ask(page: Page, question: string): Promise<void> {
  const d = await dock(page);
  await d.getByRole("textbox").first().fill(question);
  await tap(d, "Send");
  await page.waitForTimeout(2500);
}

async function validate(s: Server, id: string): Promise<void> {
  await s.api("review.set", { id, decision: "validate" }).catch(() => {});
}

async function openGenerated(page: Page): Promise<void> {
  await page
    .getByRole("complementary", { name: "Review queue" })
    .getByRole("button", { name: /Sectionneur avec TK/ })
    .first()
    .click({ timeout: T });
  await page.waitForTimeout(500);
}

// ponytail: Generate asks first to replace the tests not validated yet, when there are some
async function generate(page: Page): Promise<void> {
  await page.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await tap(page.getByRole("region", { name: "Request" }), /^Generate/);
  const replace = page.getByRole("dialog");
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
    { id: "palette-nothing", note: "Search everywhere, no match", hash: "#/tests", prep: (p) => palette(p, "zzzqqq") },
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

const DOC = "SOSIE_211_D401-1_3";
const DOC2 = "SOSIE_211_D401-1_4";
const T1420 = "LFRPS12-1420";
const T1398 = "LFRPS12-1398";
const TLOCAL = "local-3f9a12c0";

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
      id: "documents-add-path",
      note: "Add a document from a path",
      hash: "#/documents",
      prep: async (p) => {
        await tap(p, "Add from a path");
        await dialog(p);
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
            .querySelector(".docs-screen")
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
          .getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6/ })
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
      prep: (p) => p.locator(".queue-menu").nth(0).click({ timeout: T }),
    },
    {
      id: "review-folder-menu",
      note: "Filter by folder menu",
      hash: "#/review",
      prep: (p) => p.locator(".queue-menu").nth(1).click({ timeout: T }),
    },
    {
      id: "review-to-fix-dialog",
      note: "Mark as To fix dialog",
      hash: `#/review/${T1420}`,
      prep: async (p) => {
        await tap(p.getByRole("region", { name: "Test under review" }), /^To fix/);
        await dialog(p, "Mark as To fix");
      },
    },
    {
      id: "review-to-fix-empty-note",
      note: "Mark as To fix submitted without a note",
      hash: `#/review/${T1420}`,
      prep: async (p) => {
        await tap(p.getByRole("region", { name: "Test under review" }), /^To fix/);
        await dialog(p, "Mark as To fix");
        await tap(p.getByRole("dialog"), /^Mark To fix/);
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
      prep: (p) => p.getByRole("textbox", { name: "Filter tests" }).fill("zzzqqq"),
    },
    { id: "tests-bad-id", note: "A test that cannot be opened", hash: "#/tests/LFRPS12-0" },
    {
      id: "tests-editor",
      note: "Editor, a test with a modified step, a figure and preconditions",
      hash: `#/tests/${T1420}`,
      prep: (p, s) => openTest(p, s, T1420),
    },
    {
      id: "tests-editor-hidden-details",
      note: "Editor with details hidden",
      hash: `#/tests/${T1420}`,
      prep: (p) => tap(p, /^Hide details/),
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
        await dialog(p, /^Screenshot/);
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
        await dialog(p, /^Source /);
      },
    },
    {
      id: "tests-push-plan",
      note: "Push plan dialog",
      hash: `#/tests/${T1420}`,
      prep: async (p) => {
        await tap(p, "Push to Jira");
        await dialog(p, "Push plan");
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
        await see(p, "This test has no steps yet.");
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
          await palette(p, tab === "Commands" ? "docs" : "sectionneur");
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
      note: "An error toast",
      hash: "#/tests",
      prep: async (p) => {
        await fail(p, "**/api/docs/list");
        await p.goto(`${new URL(p.url()).origin}/#/documents`);
        await p.getByRole("alert").first().waitFor({ timeout: T });
      },
    },
    {
      id: "open-by-key-dialog",
      note: "Open a project by its Jira key",
      hash: "#/tests",
      prep: async (p) => {
        await tap(p, /^Project /);
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
        await tap(d, "Import saved");
        await dialog(p);
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
        await dialog(p, "Models folder");
      },
    },
    {
      id: "settings-models-pack-dialog",
      note: "Use a pack (plan dialog)",
      hash: "#/settings/models",
      prep: async (p) => {
        await tap(p, /^Use the Performance pack/);
        await dialog(p);
      },
    },
    {
      id: "settings-models-measure",
      note: "Measure a pack",
      hash: "#/settings/models",
      prep: async (p) => {
        await tap(p, /^Measure the Light pack/);
        await dialog(p);
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
        await p.goto(`${new URL(p.url()).origin}/#/jobs`);
        await p.waitForTimeout(800);
      },
    },
    {
      id: "loading-doctor",
      note: "System check running",
      hash: "#/tests",
      prep: async (p) => {
        await delay(p, "**/api/system/doctor", 60_000);
        await p.goto(`${new URL(p.url()).origin}/#/doctor`);
        await p.waitForTimeout(800);
      },
    },
    {
      id: "error-document",
      note: "A document that cannot be opened",
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
      note: "Replace the tests not validated yet? (before generating)",
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
          .getByText(/tests? written/)
          .first()
          .waitFor({ timeout: 90_000 });
      },
      settle: 1000,
    },
    {
      id: "review-sources-read",
      note: "Source panel › Sources read unfolded (a freshly generated test)",
      hash: "#/review",
      prep: async (p) => {
        await openGenerated(p);
        await step(p, 1)
          .getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6/ })
          .first()
          .click({ timeout: T });
        await tap(p.getByRole("region", { name: "Sources read" }), /^Sources read/);
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
    { id: "jobs", note: "Jobs, first job open", hash: "#/jobs" },
    {
      id: "jobs-claude",
      note: "Jobs › a job's Claude processes unfolded",
      hash: "#/jobs",
      prep: async (p) => {
        await p
          .getByRole("region", { name: "Job list" })
          .locator('[aria-expanded="false"]')
          .first()
          .click({ timeout: T });
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
    { id: "jobs", note: "No job yet", hash: "#/jobs" },
    ...settingsShots(),
    ...shellShots(),
  ];
}

function noneShots(): Shot[] {
  const setup = (id: string, note: string, hash: string): Shot => ({ id, note, hash, setup: true, ready: heading1 });
  return [
    setup("setup-access", "First run › Connect to Jira and Xray", "#/setup"),
    {
      id: "setup-access-tested",
      note: "First run › access tested",
      hash: "#/setup",
      setup: true,
      ready: heading1,
      prep: async (p) => {
        await tap(p, "Save and test the connection");
        await p
          .getByRole("status")
          .filter({ hasText: /Connected as/ })
          .first()
          .waitFor({ timeout: T });
      },
    },
    setup("setup-project", "First run › Choose a project", "#/setup/project"),
    setup("setup-pack-no-project", "First run › Search pack, no project yet", "#/setup/pack"),
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
        await tap(d, "Send");
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
      hash: "#/tests/LFRPS12-1401",
      settle: 1200,
    },
    {
      id: "tests-pushing",
      note: "Pushing to Jira",
      hash: `#/tests/${T1398}`,
      prep: async (p, s) => {
        await openTest(p, s, T1420);
        await tap(p, "Push to Jira");
        await dialog(p, "Push plan");
        await tap(p, "Confirm push");
        await dialog(p, "Pushing to Jira");
        await p.waitForTimeout(800);
      },
    },
  ];
}

function claudeOfflineShots(): Shot[] {
  return [
    { id: "dock", note: "Claude dock, Claude offline", hash: "#/documents", prep: async (p) => void (await dock(p)) },
    { id: "generate", note: "Generate with Claude offline", hash: "#/generate" },
    { id: "settings-claude", note: "Settings › Claude with Claude offline", hash: "#/settings/claude" },
    { id: "doctor", note: "System check with Claude offline", hash: "#/doctor", settle: 2500 },
  ];
}

function modelsShots(fit?: string): Shot[] {
  const shots: Shot[] = [
    { id: "settings-models", note: "Settings › Models", hash: "#/settings/models" },
    { id: "settings-search", note: "Settings › Search", hash: "#/settings/search" },
    { id: "setup-pack", note: "Search pack step", hash: "#/setup/pack", setup: true, ready: heading1 },
  ];
  if (fit)
    shots.push({
      id: "settings-models-fit",
      note: `Will the ${fit} pack fit?`,
      hash: "#/settings/models",
      prep: async (p) => {
        await tap(p, new RegExp(`^Use the ${fit} pack`));
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
        await p.addInitScript(() => {
          (window as unknown as { testimusShell: unknown }).testimusShell = {
            details: async () => ({
              message: "The core of Testimus stopped before it was ready.",
              lines: ["node: bad option: --frobnicate", "exit code 9"],
              logDir: "C:\\Users\\tester\\AppData\\Roaming\\Testimus\\logs",
            }),
            restart: async () => {},
            openLogs: async () => {},
          };
        });
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
            await dialog(p, "Push plan");
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
      shots: claudeOfflineShots(),
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
            await tap(p, /^Use the Performance pack/);
            await p.waitForTimeout(500);
            const go = p
              .getByRole("dialog")
              .getByRole("button", { name: /^(Download|Use)/ })
              .first();
            if (await go.isVisible().catch(() => false)) await go.click();
            await dialog(p, "Models folder");
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
      id: "essai",
      note: "A copy of the Essai project of this PC (not production) with the fake Jira",
      env: { TESTIMUS_MOCK_SEED: `${essai},fixture` },
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
