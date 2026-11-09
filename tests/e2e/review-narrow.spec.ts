import type { Page } from "@playwright/test";
import { boot, expect, mockServer, test } from "./helpers.ts";

mockServer(4420);

const SUMMARY_1420 = "Sectionneur sans TK — menu contextuel et propriétés";

const under = (page: Page) => page.getByRole("region", { name: "Test under review" });
const queue = (page: Page) => page.getByRole("complementary", { name: "Review queue", includeHidden: true });
const source = (page: Page) => page.getByRole("complementary", { name: "Source passage", includeHidden: true });
const strip = (page: Page, n: number) => page.getByRole("navigation", { name: `Section ${n}, collapsed` });
const bar = (page: Page, name: RegExp) =>
  page.locator("[data-ws-bar]").filter({ has: page.getByRole("tablist", { name }) });

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await boot(page, "#/review");
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
}

const chip = (page: Page) =>
  under(page)
    .getByRole("article", { name: "Step 2", exact: true })
    .getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6 “Selon le type/ });

const widthOf = (page: Page) => under(page).evaluate((el) => el.getBoundingClientRect().width);

test("a wide Review shows the queue, the test and the source passage side by side", async ({ page }) => {
  await open(page, 1440);
  await chip(page).click();
  await expect(queue(page)).toBeVisible();
  await expect(source(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: /collapsed$/ })).toHaveCount(0);
});

test("the queue folds to a strip of its icons, J and K still walk it, and the strip opens it again", async ({
  page,
}) => {
  await open(page, 1440);
  const before = await widthOf(page);
  await bar(page, /^Section 1 · Queue/)
    .getByRole("button", { name: "Collapse this section" })
    .click();
  await expect(queue(page)).toBeHidden();
  await expect(strip(page, 1)).toBeVisible();
  expect(await widthOf(page)).toBeGreaterThan(before);
  await page.keyboard.press("j");
  await expect(under(page).getByRole("heading", { level: 2 })).not.toHaveText(SUMMARY_1420);
  await page.keyboard.press("k");
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
  await strip(page, 1)
    .getByRole("button", { name: /^Queue/ })
    .click();
  await expect(queue(page)).toBeVisible();
  await expect(strip(page, 1)).toHaveCount(0);
});

test("Ctrl J shows Claude in the source's section, the source one tab away, and folds it again", async ({ page }) => {
  await open(page, 1440);
  await chip(page).click();
  await expect(source(page)).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(page.getByRole("complementary", { name: "Claude" })).toBeVisible();
  await expect(source(page)).toBeHidden();
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(source(page)).toBeVisible();
  await page.getByRole("tab", { name: "Claude" }).click();
  await expect(page.getByRole("complementary", { name: "Claude" })).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(strip(page, 3)).toBeVisible();
});

test("a narrow window folds the source first; a source clicked opens it and folds the queue instead", async ({
  page,
}) => {
  await open(page, 1000);
  await expect(queue(page)).toBeVisible();
  await expect(strip(page, 3)).toBeVisible();
  expect(await widthOf(page)).toBeGreaterThanOrEqual(420);
  await chip(page).click();
  await expect(source(page)).toBeVisible();
  await expect(queue(page)).toBeHidden();
  await expect(strip(page, 1)).toBeVisible();
});

test("on half a screen the queue and the source fold to strips, and the test keeps 420 px or more", async ({
  page,
}) => {
  await open(page, 760);
  await expect(strip(page, 1)).toBeVisible();
  await expect(strip(page, 3)).toBeVisible();
  await expect(queue(page)).toBeHidden();
  expect(await widthOf(page)).toBeGreaterThanOrEqual(420);
});
