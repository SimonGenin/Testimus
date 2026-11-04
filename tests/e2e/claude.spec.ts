import { api, boot, expect, mockServer, openDock, openTest, shoot, test } from "./helpers.ts";

const { url } = mockServer(4343);

type Shown = { test: { steps: { fields: Record<string, string> }[] } };
const action1 = async () => (await api<Shown>(url, "tests.show", { id: "LFRPS12-1420" })).test.steps[0].fields.Action;
const ORIGINAL = "Ouvrir la vue de traction de la ligne 92 et repérer le sectionneur S 12.";

test("Ask a document streams an answer whose source chips open the passage", async ({ page }) => {
  await boot(page, "#/documents/SOSIE_211_D401-1_3");
  const dock = await openDock(page);
  await expect(dock.getByRole("radio", { name: "This document" })).toHaveAttribute("aria-checked", "true");
  await dock
    .getByRole("textbox", { name: "Ask about SOSIE_211_D401-1_3" })
    .fill("Que propose le menu contextuel d'un sectionneur ?");
  await dock.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dock.getByText("Que propose le menu contextuel d'un sectionneur ?")).toBeVisible();
  await expect(dock.getByText(/Le menu contextuel d'un sectionneur dépend de son type/)).toBeVisible();
  await expect(dock.getByText(/ne précisent pas l'ordre d'affichage/)).toBeVisible();
  const chip = dock.getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6/ }).first();
  await expect(chip).toBeVisible();
  await expect(dock.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  await shoot(page, "dock-ask");

  await chip.click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("region", { name: /^Source / }) });
  await expect(dialog.locator("mark")).toContainText("Selon le type de sectionneur, le menu contextuel diffère");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the palette asks a question in the dock, on the open document", async ({ page }) => {
  await boot(page, "#/documents/SOSIE_211_D401-1_3");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search everything" });
  await palette.getByRole("combobox", { name: "Search" }).fill("quel est le menu du sectionneur");
  await palette.getByRole("option", { name: /Ask Claude: “quel est le menu du sectionneur”/ }).click();
  const dock = page.getByRole("complementary", { name: "Claude" });
  await expect(dock.getByRole("radio", { name: "This document" })).toHaveAttribute("aria-checked", "true");
  await expect(dock.getByText("quel est le menu du sectionneur")).toBeVisible();
  await expect(dock.getByText(/Le menu contextuel d'un sectionneur dépend de son type/)).toBeVisible();
});

test("On this test: Claude changes a step, the editor marks it, Revert puts it back", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const dock = await openDock(page);
  await expect(dock.getByRole("radio", { name: "Whole test" })).toHaveAttribute("aria-checked", "true");
  await expect(dock.getByText("LFRPS12-1420").first()).toBeVisible();
  await dock.getByRole("textbox", { name: "Ask Claude about this test" }).fill("Précise l'action du step 1.");
  await dock.getByRole("button", { name: "Send" }).click();

  await expect(dock.getByText("1 step changed", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(dock.getByText("Check queued", { exact: true })).toBeVisible();
  await expect.poll(action1).toContain("Vérifier l'affichage avant de continuer.");
  const main = page.getByRole("main");
  await expect(main.getByText(/Claude changed 1 step/)).toBeVisible();
  const step1 = main.getByRole("article", { name: "Step 1", exact: true });
  await expect(step1.getByText("Changed by Claude")).toBeVisible();
  await expect(step1.getByRole("textbox", { name: "Action of step 1" })).toHaveValue(
    /Vérifier l'affichage avant de continuer\.$/,
  );
  await shoot(page, "dock-on-this-test");

  await dock.getByRole("button", { name: "Revert", exact: true }).click();
  await expect(dock.getByText("Reverted")).toBeVisible();
  await expect.poll(action1).toBe(ORIGINAL);
  await expect(step1.getByRole("textbox", { name: "Action of step 1" })).toHaveValue(ORIGINAL);
  await expect(main.getByText(/Claude changed 1 step/)).toHaveCount(0);
});

test("Revert from the editor banner undoes a run", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const dock = await openDock(page);
  await dock.getByRole("button", { name: "Rephrase in house style" }).click();
  await dock.getByRole("button", { name: "Send" }).click();
  const main = page.getByRole("main");
  await expect(main.getByText(/Claude changed 1 step/)).toBeVisible({ timeout: 20_000 });
  await main.getByRole("button", { name: "Revert", exact: true }).click();
  await expect.poll(action1).toBe(ORIGINAL);
  await expect(main.getByText(/Claude changed 1 step/)).toHaveCount(0);
});
