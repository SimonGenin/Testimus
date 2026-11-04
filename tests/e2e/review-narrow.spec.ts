import type { Page } from "@playwright/test";
import { boot, expect, mockServer, openDock, test } from "./helpers.ts";

mockServer(4420);

const SUMMARY_1420 = "Sectionneur sans TK — menu contextuel et propriétés";

const under = (page: Page) => page.getByRole("region", { name: "Test under review" });
const queue = (page: Page) => page.getByRole("complementary", { name: "Review queue", includeHidden: true });
const strip = (page: Page) => page.getByRole("navigation", { name: "Review queue, folded", includeHidden: true });
const source = (page: Page) => page.getByRole("complementary", { name: "Source passage", includeHidden: true });

async function open(page: Page, width: number, dock: boolean): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await boot(page, "#/review");
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
  if (dock) await openDock(page);
  await under(page)
    .getByRole("article", { name: "Step 2", exact: true })
    .getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6 “Selon le type/ })
    .click();
  await expect(source(page)).toBeAttached();
}

const widthOf = (page: Page) => under(page).evaluate((el) => el.getBoundingClientRect().width);

test("a wide Review shows the queue, the test and the source passage side by side", async ({ page }) => {
  await open(page, 1440, false);
  await expect(queue(page)).toBeVisible();
  await expect(strip(page)).toBeHidden();
  await expect(source(page)).toBeVisible();
});

test("with the dock open beside it at 1440 px the queue folds into a previous / next strip, the source stays", async ({
  page,
}) => {
  await open(page, 1440, true);
  await expect(queue(page)).toBeHidden();
  await expect(strip(page)).toBeVisible();
  await expect(source(page)).toBeVisible();
  const s = strip(page);
  await s.getByRole("button", { name: "Next test (J)" }).click();
  await expect(under(page).getByRole("heading", { level: 2 })).not.toHaveText(SUMMARY_1420);
  await s.getByRole("button", { name: "Previous test (K)" }).click();
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
});

test("« Show the queue » of the strip lays the queue over the test; opening a test folds it again", async ({ page }) => {
  await open(page, 1440, true);
  await expect(queue(page)).toBeHidden();
  const before = await widthOf(page);
  await strip(page).getByRole("button", { name: "Show the queue" }).click();
  await expect(queue(page)).toBeVisible();
  expect(await widthOf(page)).toBe(before);
  await queue(page).getByRole("listbox", { name: "Tests to review" }).getByRole("option").nth(1).click();
  await expect(under(page).getByRole("heading", { level: 2 })).not.toHaveText(SUMMARY_1420);
  await expect(queue(page)).toBeHidden();
});

test("below 1300 px the open dock floats over Review, which keeps its own panes", async ({ page }) => {
  await open(page, 1280, true);
  await expect(queue(page)).toBeVisible();
  await expect(source(page)).toBeVisible();
});

test("on a narrow window the queue folds, then the source panel hides, and the test keeps 420 px or more", async ({
  page,
}) => {
  await open(page, 1000, false);
  await expect(queue(page)).toBeHidden();
  await expect(strip(page)).toBeVisible();
  await expect(source(page)).toBeVisible();
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(source(page)).toBeHidden();
  expect(await widthOf(page)).toBeGreaterThanOrEqual(420);
});
