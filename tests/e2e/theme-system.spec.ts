import type { Page } from "@playwright/test";
import { boot, expect, mockServer, setTheme, test } from "./helpers.ts";

mockServer(4393);

// ponytail: the page's canvas is the design token color.canvas (tokens.stylex.ts): #f7f7f8 light, #0e0e10 dark
const LIGHT = "rgb(247, 247, 248)";
const DARK = "rgb(14, 14, 16)";
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test("the System theme follows the OS colour scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await boot(page);
  await setTheme(page, "system");
  expect(await bg(page)).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => bg(page)).toBe(DARK);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  await setTheme(page, "light");
  expect(await bg(page)).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "light" });
  await setTheme(page, "dark");
  expect(await bg(page)).toBe(DARK);
});

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("the page background follows the theme chosen, and System follows the OS, without naming a colour", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await boot(page);
  await setTheme(page, "light");
  const light = await bodyBg(page);
  await setTheme(page, "dark");
  const dark = await bodyBg(page);
  expect(light).not.toBe(dark);
  await setTheme(page, "system");
  await expect.poll(() => bodyBg(page)).toBe(light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => bodyBg(page)).toBe(dark);
  await setTheme(page, "light");
  await expect.poll(() => bodyBg(page)).toBe(light);
  await page.emulateMedia({ colorScheme: "light" });
  await setTheme(page, "dark");
  await expect.poll(() => bodyBg(page)).toBe(dark);
});
