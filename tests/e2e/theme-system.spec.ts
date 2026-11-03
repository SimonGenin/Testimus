import type { Page } from "@playwright/test";
import { boot, expect, mockServer, setTheme, test } from "./helpers.ts";

mockServer(4393);

const bg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

test("the System theme follows the OS colour scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await boot(page);
  await setTheme(page, "system");
  expect(await bg(page)).toBe("#f4f6f6");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => bg(page)).toBe("#0b0f0f");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  await setTheme(page, "light");
  expect(await bg(page)).toBe("#f4f6f6");
  await page.emulateMedia({ colorScheme: "light" });
  await setTheme(page, "dark");
  expect(await bg(page)).toBe("#0b0f0f");
});
