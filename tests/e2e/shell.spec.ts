import { boot, expect, test } from "./helpers.ts";

test("the rail shows the project and moves between screens", async ({ page }) => {
  await boot(page);
  const rail = page.getByRole("navigation", { name: "Main" });
  await expect(rail.getByRole("button", { name: /^Review/ })).toContainText("2");
  await expect(rail.getByRole("button", { name: /^Generate/ })).not.toContainText(/\d/);
  for (const [name, hash] of [
    ["Documents", "#/documents"],
    ["Generate", "#/generate"],
    ["Review", "#/review"],
    ["Settings", "#/settings"],
    ["Tests", "#/tests"],
  ] as const) {
    await rail.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
  }
  const list = page.getByRole("complementary", { name: "Tests" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("tab", { name: /^Review/ })).toHaveCount(0);
  await list.getByRole("tab", { name: /^Jira/ }).click();
  await expect(list.getByRole("tab", { name: /^Jira/ })).toHaveAttribute("aria-selected", "true");
});

test("the project menu lists the projects and « All projects… » goes to the project selection", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: /^Project LFRPS12/ }).click();
  const menu = page.getByRole("menu", { name: "Projects" });
  await expect(menu.getByRole("menuitemcheckbox", { name: /RATP Sosie/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem")).toHaveText(["All projects…"]);
  for (const gone of ["Open a folder…", "Open by Jira key…", "New project…", "Show in Explorer"])
    await expect(page.getByRole("menuitem", { name: gone })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "All projects…" }).click();
  await expect(page).toHaveURL(/#\/setup\/project\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a project" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Known projects" })).toContainText("RATP Sosie");
  await page.getByRole("button", { name: "Open by Jira key…" }).click();
  await expect(page.getByRole("dialog", { name: "Open a project by its Jira key" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Open again" }).click();
  await expect(page).toHaveURL(/#\/documents$/);
  await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
});

test("the system status opens the system check", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: /^System: / }).click();
  await expect(page).toHaveURL(/#\/doctor$/);
});

test("the system status says its state in whole words, even « Not checked », in its name and its tooltip", async ({
  page,
}) => {
  await page.route("**/api/system/doctor", () => {});
  await boot(page);
  const status = page.getByRole("button", { name: "System: Not checked. Open the system check" });
  await status.hover();
  await expect(page.getByRole("tooltip", { name: "Not checked" })).toBeVisible();
  await expect(status).toHaveAccessibleDescription("Not checked");
});

test("Ctrl K opens the palette, filters and runs a command", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search everything" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search" }).fill("system.version");
  await expect(palette.getByRole("option").first()).toContainText("Testimus and Node versions");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Testimus and Node versions — done" })).toBeVisible();
});

test("the palette navigates and closes with Escape", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search everything" });
  await palette.getByRole("combobox", { name: "Search" }).fill("Go to Settings");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/settings$/);
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("Ctrl J shows Claude's tab, and folds its section when it is the tab shown", async ({ page }) => {
  await boot(page, "#/settings");
  const strip = page.getByRole("navigation", { name: "Section 3, collapsed" });
  const dock = page.getByRole("complementary", { name: "Claude" });
  await expect(strip.getByRole("button", { name: "Claude" })).toBeVisible();
  await expect(dock).toBeHidden();
  await page.keyboard.press("Control+j");
  await expect(page.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
  await expect(dock).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(strip).toBeVisible();
  await expect(dock).toBeHidden();
  await strip.getByRole("button", { name: "Claude" }).click();
  await expect(dock).toBeVisible();
});

test("Claude's section starts folded where the screen keeps it so, even on a wide window", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await boot(page, "#/settings");
  await expect(
    page.getByRole("navigation", { name: "Section 3, collapsed" }).getByRole("button", { name: "Claude" }),
  ).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Claude" })).toBeHidden();
});

test("the theme is chosen in Settings › Appearance, not from the rail, and survives a reload", async ({ page }) => {
  await boot(page, "#/settings/appearance");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Theme/ })).toHaveCount(0);
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await theme.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});
