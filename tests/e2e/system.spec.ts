import { api, boot, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const { url } = mockServer(4352);

test("first launch finds the existing access, tests it, then moves to the project step", async ({ page }) => {
  await page.goto("/#/setup");
  await expect(page.getByRole("heading", { level: 1, name: "Connect to Jira and Xray" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Site address" })).toHaveValue("https://mock.atlassian.net");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("tester@example.com");
  await shoot(page, "first-run");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Jira reachable and authenticated" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Xray reachable and authenticated" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/#\/setup\/project$/);
  await shoot(page, "first-run-project");
  await page.getByRole("button", { name: "Back to the app" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("the system check lists every check with its state", async ({ page }) => {
  await boot(page, "#/doctor");
  await expect(page.getByRole("heading", { level: 1, name: "System check" })).toBeVisible();
  const checks = page.getByRole("list", { name: "Checks" }).getByRole("listitem");
  await expect(checks.filter({ hasText: "Node runtime" })).toContainText("OK");
  await expect(checks.filter({ hasText: "Claude Code CLI" })).toContainText("OK");
  await expect(checks.filter({ hasText: "Jira reachable" })).toContainText("OK");
  await expect(checks.filter({ hasText: "Claude signed in" })).toContainText("Not checked");
  await shoot(page, "doctor");
  await page.getByRole("button", { name: "Check Claude sign-in" }).click();
  await expect(checks.filter({ hasText: "Claude signed in" })).toContainText("OK", { timeout: 15_000 });
});

test("settings save the step field preferences and the editor honours them", async ({ page }) => {
  await boot(page, "#/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Jira project" })).toHaveValue("LFRPS12");
  const fields = page.getByRole("region", { name: "Step fields" });
  await expect(fields.getByRole("checkbox", { name: "Data folded by default" })).toBeChecked();
  await shoot(page, "settings");

  await fields.getByRole("checkbox", { name: "Data folded by default" }).click();
  await fields.getByRole("button", { name: "Move Exigence up" }).click();
  await expect
    .poll(async () => {
      const xray = (await api<{ xray: { prefs?: { order?: string[]; collapsed?: string[] } } }>(url, "project.info"))
        .xray;
      return JSON.stringify(xray.prefs);
    })
    .toMatch(/"order":\["Action","Data","Exigence","Expected Result"\].*|"collapsed":\[\]/);
  await expect
    .poll(
      async () =>
        (await api<{ xray: { prefs?: { collapsed?: string[] } } }>(url, "project.info")).xray.prefs?.collapsed,
    )
    .not.toContain("Data");

  await openTest(page, "LFRPS12-1420");
  const step1 = page.getByRole("main").getByRole("article", { name: "Step 1", exact: true });
  await expect(step1.getByRole("button", { name: "Show Data of step 1" })).toHaveCount(0);
  const labels = (await step1.locator(".fl-k").allInnerTexts()).map((l) => l.trim());
  expect(labels.indexOf("Exigence")).toBeLessThan(labels.indexOf("Expected Result"));
});

test("settings switch the theme from Appearance", async ({ page }) => {
  await boot(page, "#/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance" }).click();
  const appearance = page.getByRole("region", { name: "Appearance" });
  await expect(appearance).toBeVisible();
  await appearance
    .getByRole("button", { name: "Dark" })
    .or(appearance.getByRole("radio", { name: "Dark" }))
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
