import { boot, expect, test } from "./helpers.ts";

test("the rail shows the project and moves between screens", async ({ page }) => {
  await boot(page);
  const rail = page.getByRole("navigation", { name: "Main" });
  await expect(rail.getByRole("button", { name: /^Review/ })).toContainText("2");
  for (const [name, hash] of [
    ["Documents", "#/documents"],
    ["Generate", "#/generate"],
    ["Review", "#/review"],
    ["Jobs", "#/jobs"],
    ["Settings", "#/settings"],
    ["Tests", "#/tests"],
  ] as const) {
    await rail.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
  }
  await expect(page.getByRole("complementary", { name: "Tests" })).toBeVisible();
});

test("the system status opens the system check", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: /^System: / }).click();
  await expect(page).toHaveURL(/#\/doctor$/);
});

test("Ctrl K opens the palette, filters and runs a command", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Command" }).fill("system.version");
  await expect(palette.getByRole("option").first()).toContainText("Testimus and Node versions");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "system.version done" })).toBeVisible();
});

test("the palette navigates and closes with Escape", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command" }).fill("Go to Jobs");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/jobs$/);
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("Ctrl J folds and opens the Claude dock", async ({ page }) => {
  await boot(page);
  const dock = page.getByRole("complementary", { name: "Claude" });
  await expect(dock.getByRole("heading", { name: "Claude" })).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(dock.getByRole("button", { name: "Open Claude" })).toBeVisible();
  await expect(dock.getByRole("heading", { name: "Claude" })).toHaveCount(0);
  await page.keyboard.press("Control+j");
  await expect(dock.getByRole("heading", { name: "Claude" })).toBeVisible();
  await dock.getByRole("button", { name: /^Hide/ }).click();
  await dock.getByRole("button", { name: "Open Claude" }).click();
  await expect(dock.getByRole("heading", { name: "Claude" })).toBeVisible();
});

test("the dock is folded at 1280 px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await boot(page);
  await expect(
    page.getByRole("complementary", { name: "Claude" }).getByRole("button", { name: "Open Claude" }),
  ).toBeVisible();
});

test("the theme toggle sets data-theme and survives a reload", async ({ page }) => {
  await boot(page);
  const toggle = page.getByRole("button", { name: /^Theme: / });
  await expect(toggle).toHaveAttribute("aria-label", /^Theme: System\./);
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-label", /^Theme: Dark\./);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /^Theme: Dark\./ })).toBeVisible();
  await page.getByRole("button", { name: /^Theme: / }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});
