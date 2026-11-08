import type { Locator, Page } from "@playwright/test";
import { expect, mockServer, openTest, test } from "./helpers.ts";

mockServer(4421);

const shown = (button: Locator) => button.evaluate((el) => getComputedStyle(el.parentElement as Element).opacity);

async function pointAt(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to point at");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function away(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
}

const fieldOf = (page: Page, label: string) =>
  page
    .getByRole("main")
    .getByRole("article", { name: "Step 1" })
    .getByRole("textbox", { name: `${label} of step 1` })
    .locator("xpath=ancestor::*[@data-field][1]");

test("the insert bands of a field fade in only when hovered, and then take a click", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const field = fieldOf(page, "Expected Result");
  const plusText = field.getByRole("button", { name: "Text", exact: true });
  expect(await plusText.count()).toBeGreaterThanOrEqual(2);
  await away(page);
  for (const b of await plusText.all()) await expect.poll(() => shown(b)).toBe("0");

  const last = plusText.last();
  await pointAt(page, last);
  await expect.poll(() => shown(last)).toBe("1");
  await expect.poll(() => shown(plusText.first())).toBe("0");
  await last.click();
  await expect(field.getByRole("textbox")).toHaveCount(2);
});

test("a new table: blank heads, the focus in the first, its tools always in view and the handles on the cell being written", async ({
  page,
}) => {
  await openTest(page, "LFRPS12-1420");
  const field = fieldOf(page, "Action");
  await pointAt(page, field.getByRole("textbox", { name: "Action of step 1" }));
  await field.getByRole("button", { name: "Add a table after this text of Action of step 1" }).click();
  const table = field.getByRole("table", { name: "Table in Action of step 1" });
  await expect(table).toBeVisible();
  const head = table.getByRole("textbox", { name: "Action of step 1, header row, column 1" });
  await expect(head).toBeFocused();
  await expect(head).toHaveAttribute("placeholder", "Column name");
  await expect(table.getByRole("cell").filter({ hasText: "Empty —" })).toHaveCount(0);
  await expect(table.getByRole("button", { name: /Delete/ })).toHaveCount(0);

  await away(page);
  await expect(field.getByRole("button", { name: "Table options" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Add row" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Add column" })).toBeVisible();
  await expect(table.getByRole("button", { name: /Options for/ })).toHaveCount(0);

  await head.click();
  await page.keyboard.type("Champ");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Valeur");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Position");
  await expect(table.getByRole("button", { name: "Options for row « Position »" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Options for column « Champ »" })).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("textbox", { name: "Action of step 1, row 2, column « Champ »" })).toBeFocused();

  await table.getByRole("button", { name: "Options for column « Champ »" }).click();
  await page.getByRole("menuitem", { name: "Delete column" }).click();
  await expect(page.getByText("Column « Champ » deleted")).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(1);
});
