import { api, boot, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const { url } = mockServer(4352);

test("first launch finds the existing access, tests it, then moves to the project step", async ({ page }) => {
  await page.goto("/#/setup");
  await expect(page.getByRole("heading", { level: 1, name: "Connect to Jira and Xray" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Jira site" })).toHaveValue(/^https:\/\/mock\.atlassian\.net/);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("tester@example.com");
  await expect(page.getByRole("button", { name: "Open API tokens" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Jira apps" })).toBeVisible();
  await shoot(page, "first-run");
  await page.getByRole("button", { name: "Save and test the connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Connected as/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Key accepted" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/#\/setup\/project$/);
  await shoot(page, "first-run-project");
  await page.getByRole("button", { name: "Back to the app" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("the system check lists every check with its state", async ({ page }) => {
  await boot(page, "#/doctor");
  await expect(page.getByRole("heading", { level: 1, name: "System check" })).toBeVisible();
  const checks = page.getByRole("region", { name: "Checks" }).getByRole("row");
  await expect(checks.filter({ hasText: "Node runtime" })).toContainText("OK");
  await expect(checks.filter({ hasText: "Claude Code CLI" })).toContainText("OK");
  await expect(checks.filter({ hasText: "Jira reachable" })).toContainText("OK");
  await expect(checks.filter({ hasText: "Claude signed in" })).toContainText("Not checked");
  await shoot(page, "doctor");
  await page.getByRole("button", { name: "Check Claude sign-in" }).click();
  await expect(checks.filter({ hasText: "Claude signed in" })).toContainText("OK", { timeout: 15_000 });
});

test("settings save the smart column preferences and the editor honours them", async ({ page }) => {
  await boot(page, "#/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Jira project" })).toHaveValue("LFRPS12");
  await expect(page.getByRole("region", { name: "Smart columns" })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("option", { name: "Smart columns" })
    .click();
  await expect(page.getByRole("textbox", { name: "Jira project" })).toHaveCount(0);
  const fields = page.getByRole("region", { name: "Smart columns" });
  const dataFold = fields.getByRole("radiogroup", { name: "Data folding" });
  await expect(dataFold.getByRole("radio", { name: "When filled" })).toBeChecked();
  await shoot(page, "settings");

  await dataFold.getByRole("radio", { name: "Open" }).click();
  await fields.getByRole("button", { name: "Move Exigence up" }).click();
  type Columns = { columns: { name: string; mode: string }[] };
  await expect
    .poll(async () => (await api<Columns>(url, "project.info")).columns.map((c) => c.name).join(","))
    .toBe("Action,Data,Exigence,Expected Result");
  await expect
    .poll(async () => (await api<Columns>(url, "project.info")).columns.find((c) => c.name === "Data")?.mode)
    .toBe("open");

  await openTest(page, "LFRPS12-1420");
  const step1 = page.getByRole("main").getByRole("article", { name: "Step 1", exact: true });
  await expect(step1.getByRole("button", { name: "Data column of step 1" })).toHaveAttribute("aria-pressed", "true");
  const labels = (await step1.locator(".fl-k").allInnerTexts()).map((l) => l.trim());
  expect(labels.indexOf("Exigence")).toBeLessThan(labels.indexOf("Expected Result"));
});

test("settings switch the theme from Appearance", async ({ page }) => {
  await boot(page, "#/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("option", { name: "Appearance" }).click();
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await expect(theme).toBeVisible();
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
