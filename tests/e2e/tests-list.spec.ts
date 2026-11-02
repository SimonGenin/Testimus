import { api, boot, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const { url } = mockServer(4347);

test("the local list groups tests by folder and filters by text", async ({ page }) => {
  await boot(page, "#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await expect(side.getByRole("tab", { name: "Local" })).toHaveAttribute("aria-selected", "true");
  await expect(side.getByRole("button", { name: /LFRPS12-1398 Validated Up to date$/ })).toBeVisible();
  await expect(side.getByRole("button", { name: /no key To fix Local only$/ })).toBeVisible();
  await side.getByRole("textbox", { name: "Search tests" }).fill("1398");
  await expect(side.getByRole("button", { name: /LFRPS12-1398/ })).toBeVisible();
  await expect(side.getByRole("button", { name: /LFRPS12-1420/ })).toHaveCount(0);
  await side.getByRole("textbox", { name: "Search tests" }).fill("");
  await side.getByRole("button", { name: /LFRPS12-1420 Checked Modified$/ }).click();
  await expect(page).toHaveURL(/#\/tests\/LFRPS12-1420$/);
  await expect(page.getByRole("main").getByRole("textbox", { name: "Summary" })).toHaveValue(
    "Sectionneur sans TK — menu contextuel et propriétés",
  );
});

test("the Jira tab shows the folder tree and pulls a remote test", async ({ page }) => {
  await boot(page, "#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await side.getByRole("tab", { name: "Jira" }).click();
  await side.getByRole("button", { name: /^Traction \d+$/ }).click();
  await side.getByRole("button", { name: /^Disjoncteurs \d+$/ }).click();
  const remote = side.getByRole("button", { name: /LFRPS12-1401 .*Not pulled$/ });
  await expect(remote).toBeVisible();
  await expect(side.getByRole("button", { name: /LFRPS12-1398 .*Up to date$/ })).toBeVisible();
  await shoot(page, "tests-jira");
  const before = (await api<unknown[]>(url, "tests.list")).length;
  await remote.click();
  await expect.poll(async () => (await api<unknown[]>(url, "tests.list")).length).toBe(before + 1);
  await expect(page).toHaveURL(/#\/tests\/LFRPS12-1401$/);
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
