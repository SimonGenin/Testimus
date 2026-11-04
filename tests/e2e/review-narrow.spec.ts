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

test("with the dock open at 1280 px the queue folds into a previous / next strip, the source stays", async ({
  page,
}) => {
  await open(page, 1280, true);
  await expect(queue(page)).toBeHidden();
  await expect(strip(page)).toBeVisible();
  await expect(source(page)).toBeVisible();
  const s = strip(page);
  await s.getByRole("button", { name: "Next test (J)" }).click();
  await expect(under(page).getByRole("heading", { level: 2 })).not.toHaveText(SUMMARY_1420);
  await s.getByRole("button", { name: "Previous test (K)" }).click();
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
});

test("with the dock open at 1080 px the source panel hides too, and the test keeps 420 px or more", async ({
  page,
}) => {
  await open(page, 1080, true);
  await expect(queue(page)).toBeHidden();
  await expect(strip(page)).toBeVisible();
  await expect(source(page)).toBeHidden();
  expect(await widthOf(page)).toBeGreaterThanOrEqual(420);
});
