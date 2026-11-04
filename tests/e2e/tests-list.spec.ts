import type { Locator } from "@playwright/test";
import { api, boot, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const { url } = mockServer(4347);

const row = (side: Locator, name: RegExp) =>
  side.getByRole("treeitem", { name }).or(side.getByRole("option", { name }));

test("the local list groups tests by folder and filters by text", async ({ page }) => {
  await boot(page, "#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await expect(side.getByRole("tab", { name: /^Local/ })).toHaveAttribute("aria-selected", "true");
  await expect(side.getByRole("tab", { name: /^Local/ })).toContainText("1");
  await expect(row(side, /^Disjoncteur — ouverture à distance LFRPS12-1398/)).toBeVisible();
  // ponytail: the two generated tests of the fixture are not validated yet — they wait in Review
  await expect(row(side, /LFRPS12-1420/)).toHaveCount(0);
  await expect(row(side, /^Sectionneur avec TK/)).toHaveCount(0);
  await side.getByRole("searchbox", { name: "Filter tests" }).fill("Disjoncteur");
  await expect(row(side, /LFRPS12-1398/).first()).toBeVisible();
  await expect(side.getByRole("button", { name: /Search Jira for/ })).toBeVisible();
  await side.getByRole("searchbox", { name: "Filter tests" }).fill("");
  await row(side, /^Disjoncteur — ouverture à distance LFRPS12-1398/).click();
  await expect(page).toHaveURL(/#\/tests\/LFRPS12-1398$/);
  await expect(page.getByRole("main").getByRole("textbox", { name: "Summary" })).toHaveValue(
    "Disjoncteur — ouverture à distance",
  );
  await page.goto("/#/tests/LFRPS12-1420");
  await expect(page).toHaveURL(/#\/review\/LFRPS12-1420$/);
  await expect(
    page
      .getByRole("complementary", { name: "Review queue" })
      .getByRole("option", { name: /^Sectionneur sans TK/, selected: true }),
  ).toBeVisible();
});

test("the Jira tab shows the folder tree and pulls a remote test", async ({ page }) => {
  await boot(page, "#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await side.getByRole("tab", { name: "Jira" }).click();
  await expect(row(side, /^Test Repository/)).toBeVisible();
  await row(side, /^Traction [\d/]+$/).click();
  await row(side, /^Disjoncteurs [\d/]+$/).click();
  const remote = row(side, /LFRPS12-1401.*steps?$/);
  await expect(remote.locator("[aria-describedby]").first()).toHaveAccessibleDescription(/Not pulled yet/);
  await expect(remote).toBeVisible();
  await expect(row(side, /LFRPS12-1398.*In sync.*\d+ steps?$/)).toBeVisible();
  await shoot(page, "tests-jira");
  const before = (await api<unknown[]>(url, "tests.list")).length;
  await remote.click();
  await expect.poll(async () => (await api<unknown[]>(url, "tests.list")).length).toBe(before + 1);
  await expect(page).toHaveURL(/#\/tests\/LFRPS12-1401$/);
  await expect(page.getByRole("main").getByRole("article", { name: "Step 1" })).toBeVisible();
});

test("a typed issue number searches Jira, and a local row's ✕ deletes a pushed, unchanged copy at once", async ({
  page,
}) => {
  await boot(page, "#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await side.getByRole("searchbox", { name: "Search Jira" }).fill("1401");
  await expect(side.getByRole("tab", { name: /Jira/ })).toHaveAttribute("aria-selected", "true");
  await expect(side.getByText(/found/)).toBeVisible();
  await side.getByRole("searchbox", { name: "Search Jira" }).fill("");
  await side.getByRole("tab", { name: /Local/ }).click();
  await row(side, /LFRPS12-1398/).hover();
  await side.getByRole("button", { name: /^Delete the local copy of LFRPS12-1398/ }).click();
  await expect
    .poll(async () => (await api<{ id: string }[]>(url, "tests.list")).map((t) => t.id))
    .not.toContain("LFRPS12-1398");
});

test("a new test starts as a local draft with one step", async ({ page }) => {
  await boot(page, "#/tests");
  await page.getByRole("complementary", { name: "Tests" }).getByRole("button", { name: "New test" }).click();
  await expect(page).toHaveURL(/#\/tests\/local-[0-9a-f]{8}$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("article")).toHaveCount(1);
  await expect(main.getByText("Draft", { exact: true })).toBeVisible();
});

test("the editor at 1280 px keeps the Claude dock folded", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await openTest(page, "LFRPS12-1420");
  await expect(
    page.getByRole("complementary", { name: "Claude" }).getByRole("button", { name: "Open Claude" }),
  ).toBeVisible();
  await shoot(page, "tests-editor-1280");
});
