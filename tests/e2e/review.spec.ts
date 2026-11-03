import type { Page } from "@playwright/test";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4346);

const review = async (id: string) => (await api<{ test: { review: string } }>(url, "tests.show", { id })).test.review;
const queue = (page: Page) => page.getByRole("complementary", { name: "Review queue" });
const under = (page: Page) => page.getByRole("region", { name: "Test under review" });
const SUMMARY_1420 = "Sectionneur sans TK — menu contextuel et propriétés";
const SUMMARY_LOCAL = "Sectionneur avec TK — manœuvre régulière";

test("the queue lists what awaits review and filters by state", async ({ page }) => {
  await boot(page, "#/review");
  await expect(queue(page).getByText("Generated tests")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Review/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const items = queue(page).getByRole("button", { name: /\/Traction\/Sectionneurs/ });
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("2 errors");
  await queue(page)
    .getByRole("button", { name: /^To fix 1/ })
    .click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(SUMMARY_LOCAL);
  await queue(page)
    .getByRole("button", { name: /^Checked 1/ })
    .click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(SUMMARY_1420);
  await queue(page)
    .getByRole("button", { name: /^All 2/ })
    .click();
  await expect(items).toHaveCount(2);
});

test("findings sit on their steps and a source shows its passage with the quote highlighted", async ({ page }) => {
  await boot(page, "#/review");
  await expect(under(page).getByRole("heading", { level: 2, name: SUMMARY_1420 })).toBeVisible();
  const step2 = under(page).getByRole("article", { name: "Step 2", exact: true });
  await expect(step2.getByRole("note").filter({ hasText: "Unsupported" })).toBeVisible();
  const step5 = under(page).getByRole("article", { name: "Step 5", exact: true });
  await expect(step5.getByRole("note").filter({ hasText: "Not simulated" })).toBeVisible();
  await expect(under(page).getByRole("note").filter({ hasText: "Negative missing" })).toBeVisible();
  await expect(under(page).getByRole("article", { name: "Step 1", exact: true })).toContainText("No findings");

  await step2.getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6 « Selon le type/ }).click();
  const panel = page.getByRole("complementary", { name: "Source passage" });
  await expect(panel.locator("mark")).toContainText("Selon le type de sectionneur, le menu contextuel diffère");
  await expect(panel.getByRole("img", { name: /Figure 40/ })).toBeVisible();
  await shoot(page, "review");
});

test("J and K move through the queue", async ({ page }) => {
  await boot(page, "#/review");
  const title = under(page).getByRole("heading", { level: 2 });
  await expect(title).toHaveText(SUMMARY_1420);
  await page.keyboard.press("j");
  await expect(title).toHaveText(SUMMARY_LOCAL);
  await page.keyboard.press("k");
  await expect(title).toHaveText(SUMMARY_1420);
});

test("To fix with a note asks Claude to fix it; the test comes back Checked, never Validated", async ({ page }) => {
  await boot(page, "#/review");
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
  await under(page)
    .getByRole("button", { name: /^To fix/ })
    .click();
  const note = page.getByRole("dialog", { name: "Mark as To fix" });
  await note.getByRole("button", { name: /^Mark To fix/ }).click();
  await expect(note.getByRole("alert")).toHaveText("Say what is wrong: the note is required.");
  await note
    .getByRole("textbox", { name: /Note for the author/ })
    .fill("Sourcer la vue du step 2 et ajouter le cas du sectionneur avec TK.");
  await expect(note.getByRole("checkbox", { name: /Then ask Claude to fix it/ })).toBeChecked();
  await shoot(page, "review-to-fix");
  await note.getByRole("button", { name: /^Mark To fix/ }).click();
  await expect(note).toBeHidden();

  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        const r = await review("LFRPS12-1420");
        seen.add(r);
        return r;
      },
      { timeout: 30_000 },
    )
    .toBe("checked");
  expect(seen.has("validated")).toBe(false);
  const dock = page.getByRole("complementary", { name: "Claude" });
  await expect(dock.getByText(/sectionneur avec TK/).first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("V validates the open test and the queue moves on", async ({ page }) => {
  await boot(page, "#/review");
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_1420);
  await page.keyboard.press("v");
  await expect(page.getByRole("status").filter({ hasText: "Validated" }).first()).toBeVisible();
  await expect.poll(() => review("LFRPS12-1420")).toBe("validated");
  await expect(under(page).getByRole("heading", { level: 2 })).toHaveText(SUMMARY_LOCAL);
  await expect(queue(page).getByRole("button", { name: /\/Traction\/Sectionneurs/ })).toHaveCount(1);
});
