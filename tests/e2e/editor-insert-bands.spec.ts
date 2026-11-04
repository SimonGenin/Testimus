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

test("the insert bands of a field fade in only when hovered, and then take a click (PARITY #42)", async ({ page }) => {
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

test("in a table, an empty cell always shows its insert strip, a filled one only while its strip is hovered (PARITY #42)", async ({
  page,
}) => {
  await openTest(page, "LFRPS12-1420");
  const field = fieldOf(page, "Action");
  const addTable = field.getByRole("button", { name: "Table", exact: true }).last();
  await pointAt(page, addTable);
  await addTable.click();
  const table = field.getByRole("table");
  await expect(table).toBeVisible();
  const heads = table.getByRole("columnheader").filter({ hasText: "Heading" });
  const empty = table.getByRole("cell").filter({ hasText: "Empty — type, paste an image or add a table" });
  await expect(heads).toHaveCount(2);
  await expect(empty).toHaveCount(2);
  const bandOf = (cell: Locator) => cell.getByRole("button", { name: "Text", exact: true }).first();
  const stripOf = (cell: Locator) => cell.getByRole("group", { name: "Insert a block" }).first();
  const hintOf = (cell: Locator) =>
    cell.getByText("Empty — type, paste an image or add a table").evaluate((el) => getComputedStyle(el).opacity);

  await away(page);
  for (const c of await empty.all()) await expect.poll(() => hintOf(c)).toBe("1");
  for (const c of await heads.all()) await expect.poll(() => shown(bandOf(c))).toBe("0");

  await pointAt(page, stripOf(heads.nth(0)));
  await expect.poll(() => shown(bandOf(heads.nth(0)))).toBe("1");
  await expect.poll(() => shown(bandOf(heads.nth(1)))).toBe("0");
  await pointAt(page, stripOf(heads.nth(1)));
  await expect.poll(() => shown(bandOf(heads.nth(1)))).toBe("1");
  await expect.poll(() => shown(bandOf(heads.nth(0)))).toBe("0");
});
