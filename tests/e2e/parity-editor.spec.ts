import type { Page } from "@playwright/test";
import { api, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const { url } = mockServer(4390);

type Shown = {
  test: { preconditions: string[]; steps: { id?: string; fields: Record<string, string> }[] };
  remote: { steps: { id?: string; fields: Record<string, string> }[] } | null;
  sync: string;
};

const show = (id: string) => api<Shown>(url, "tests.show", { id });
const main = (page: Page) => page.getByRole("main");
const more = async (page: Page, item: string) => {
  await main(page).getByRole("button", { name: "More actions for this test" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};

test("a step that differs from the last sync is marked, shows its Jira version and is restored", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const marked = main(page).locator(".step.is-modified");
  await expect(marked).toHaveCount(1);
  await expect(marked.getByText("modified", { exact: true })).toBeVisible();
  await marked.getByRole("button", { name: "Jira version" }).click();
  const was = marked.getByRole("region", { name: /as Jira has it$/ });
  await expect(was.getByText("In Jira, last synced")).toBeVisible();
  await expect(
    was.getByRole("textbox").filter({ hasText: "Le menu propose les commandes du sectionneur." }),
  ).toHaveCount(1);
  await shoot(page, "parity-jira-version");
  await was.getByRole("button", { name: "Restore this step" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore this step" }).click();
  await expect(main(page).locator(".step.is-modified")).toHaveCount(0);
  await expect
    .poll(async () => {
      const r = await show("LFRPS12-1420");
      return JSON.stringify(r.test.steps.map((s) => s.fields)) === JSON.stringify(r.remote?.steps.map((s) => s.fields));
    })
    .toBe(true);
});

test("a deleted step leaves a placeholder that brings it back", async ({ page }) => {
  await openTest(page, "LFRPS12-1398");
  const n = await main(page).getByRole("article").count();
  await main(page)
    .getByRole("article", { name: "Step 1", exact: true })
    .getByRole("button", { name: "Delete step 1" })
    .click();
  await expect(main(page).getByRole("article")).toHaveCount(n - 1);
  const gone = main(page).getByRole("region", { name: "Deleted step" });
  await expect(gone).toBeVisible();
  await gone.getByRole("button", { name: "Jira version" }).click();
  await gone.getByRole("button", { name: "Bring the step back" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Bring the step back" }).click();
  await expect(main(page).getByRole("article")).toHaveCount(n);
  await expect(main(page).getByRole("region", { name: "Deleted step" })).toHaveCount(0);
});

test("preconditions: the panel shows definitions, the header attaches one from the project's list", async ({
  page,
}) => {
  await openTest(page, "LFRPS12-1420");
  const panel = main(page).locator(".precond-list");
  await expect(panel.getByRole("button", { name: "LFRPS12-77" })).toBeVisible();
  await expect(panel.getByText("Exercice chargé sur la ligne 92")).toBeVisible();
  await expect(panel.getByText(/Le logiciel R³ est lancé/)).toBeVisible();
  await main(page).getByRole("combobox", { name: "Attach precondition" }).selectOption("LFRPS12-78");
  await expect.poll(async () => (await show("LFRPS12-1420")).test.preconditions).toEqual(["LFRPS12-77", "LFRPS12-78"]);
  await main(page).getByRole("button", { name: "Detach LFRPS12-78" }).click();
  await expect.poll(async () => (await show("LFRPS12-1420")).test.preconditions).toEqual(["LFRPS12-77"]);
});

test("the Columns popover folds Data for this test only", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  await main(page).getByRole("button", { name: "Columns" }).click();
  const pop = page.getByRole("dialog", { name: "Step columns" });
  await pop.getByRole("button", { name: "this test" }).click();
  await pop.getByRole("group", { name: "Data column" }).getByRole("button", { name: "collapsed" }).click();
  await expect
    .poll(async () => (await api<{ own: unknown }>(url, "tests.columns", { id: "LFRPS12-1420" })).own)
    .toEqual({ Data: "collapsed" });
  await expect(main(page).getByRole("textbox", { name: /^Data of step/ })).toHaveCount(0);
  await pop.getByRole("button", { name: "use project's" }).click();
  await expect
    .poll(async () => (await api<{ own: unknown }>(url, "tests.columns", { id: "LFRPS12-1420" })).own)
    .toBeNull();
});

test("Undo local changes counts what is lost and rewinds to the last sync", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  await main(page).getByRole("textbox", { name: "Summary" }).fill("Changed locally");
  await expect.poll(async () => (await show("LFRPS12-1420")).sync).toBe("modified");
  await more(page, "Undo local changes");
  const d = page.getByRole("dialog", { name: "Undo every local change?" });
  await expect(d.getByText(/modified · \d+ added · \d+ deleted step\(s\)/)).toBeVisible();
  await d.getByRole("button", { name: "Undo local changes" }).click();
  await expect.poll(async () => (await show("LFRPS12-1420")).sync).toBe("synced");
  // ponytail: Jira's version of a generated test was never validated here — it goes back to Review
  await expect(page).toHaveURL(/#\/review\/LFRPS12-1420$/);
  await expect(
    page.getByRole("heading", { name: "Sectionneur sans TK — menu contextuel et propriétés" }),
  ).toBeVisible();
});

test("Open in Jira opens the issue page", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const popup = page.waitForEvent("popup");
  await more(page, "Open in Jira ↗");
  expect((await popup).url()).toContain("/browse/LFRPS12-1420");
});

test("Delete local copy asks for a never-pushed test and closes the editor", async ({ page }) => {
  await openTest(page, "local-3f9a12c0");
  await more(page, "Delete local copy");
  const d = page.getByRole("dialog", { name: "Delete the local copy?" });
  await expect(d.getByText(/never pushed, so this is the only copy/)).toBeVisible();
  await d.getByRole("button", { name: "Delete local copy" }).click();
  await expect(page).toHaveURL(/#\/tests$/);
  await expect
    .poll(async () => (await api<{ id: string }[]>(url, "tests.list", {})).map((t) => t.id))
    .not.toContain("local-3f9a12c0");
});
