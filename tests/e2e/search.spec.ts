import { boot, expect, mockServer, test } from "./helpers.ts";

mockServer(4397);

test("Ctrl K searches the tests and the documents, and opens a hit", async ({ page }) => {
  await boot(page, "#/documents");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search everywhere" });
  await palette.getByRole("combobox", { name: "Search" }).fill("sectioneur menu");
  await expect(palette.getByText("In the documents", { exact: true }).last()).toBeVisible();
  await expect(palette.getByRole("option", { name: /Sectionneur sans TK/ })).toBeVisible();
  await expect(palette.locator("mark.hl").first()).toBeVisible();
  await palette.getByRole("tab", { name: "Tests" }).click();
  await expect(palette.getByText("In the documents", { exact: true })).toHaveCount(0);
  await palette.getByRole("combobox", { name: "Search" }).fill("ouvrir fermer");
  await palette.getByRole("option", { name: /Disjoncteur — ouverture à distance/ }).click();
  await expect(page).toHaveURL(/#\/tests\/LFRPS12-1398$/);
});

test("the tests list ranks by what the steps say and shows where", async ({ page }) => {
  await boot(page, "#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await side.getByRole("textbox", { name: "Filter tests" }).fill("fermé");
  const row = side.getByRole("button", { name: /Disjoncteur — ouverture à distance/ });
  await expect(row).toContainText("Step 1 · Expected Result");
  await row.click();
  await expect(page).toHaveURL(/#\/tests\/LFRPS12-1398$/);
});
