import type { Page } from "@playwright/test";
import { boot, expect, mockServer, setTheme, test } from "./helpers.ts";

mockServer(4398);

const probe = (page: Page) => page.getByRole("button", { name: "StyleX probe" });
const background = (page: Page) => probe(page).evaluate((el) => getComputedStyle(el).backgroundColor);

test("the kit screen is styled by StyleX tokens, in the light and the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await boot(page, "#/kit");
  await setTheme(page, "light");
  await expect(probe(page)).toBeVisible();
  expect(await background(page)).toBe("rgb(47, 91, 211)");
  await setTheme(page, "dark");
  await expect.poll(() => background(page)).toBe("rgb(125, 156, 240)");
  await setTheme(page, "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => background(page)).toBe("rgb(125, 156, 240)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => background(page)).toBe("rgb(47, 91, 211)");
});
