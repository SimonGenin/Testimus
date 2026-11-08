import type { Page } from "@playwright/test";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const server = mockServer(4348);

test("a request runs live, the tests land, and « Review these tests » opens them", async ({ page }) => {
  const before = (await api<unknown[]>(server.url, "tests.list")).length;
  await boot(page, "#/generate");
  await expect(page.getByRole("heading", { level: 1, name: "Generate" })).toBeVisible();
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  const docs = request.getByRole("list", { name: "Documents in scope" });
  await expect(docs.getByRole("checkbox")).toHaveCount(5);
  for (const box of await docs.getByRole("checkbox").all()) await expect(box).toBeChecked();
  await expect(request.getByRole("button", { name: "Generate" })).toBeEnabled();
  await request.getByRole("button", { name: "Select none" }).click();
  await expect(request.getByRole("button", { name: "Generate" })).toBeDisabled();
  await request.getByRole("button", { name: "Select all" }).click();
  await expect(request.getByRole("list", { name: "Smart columns" }).getByText("Exigence")).toBeVisible();
  await expect(result.getByText("Tests appear here as Claude writes them")).toBeVisible();
  await shoot(page, "generate");

  await docs
    .getByRole("listitem")
    .filter({ hasText: "Traction" })
    .getByRole("button", { name: "Only some sections…" })
    .click();
  await request
    .getByRole("button", { name: /^Unfold/ })
    .first()
    .click();
  await expect(request.getByRole("list", { name: "Sections" }).getByRole("checkbox").first()).toBeVisible();
  await shoot(page, "generate-sections");
  await request.getByRole("button", { name: "Text", exact: true }).first().click();
  const passage = page.getByRole("dialog");
  await expect(passage.getByRole("region", { name: /^Source / })).toBeVisible();
  await shoot(page, "generate-section-text");
  await page.keyboard.press("Escape");
  await expect(passage).toHaveCount(0);
  await request.getByRole("button", { name: "Back to the whole document" }).click();

  await request
    .getByRole("textbox", { name: "What should be tested?" })
    .fill("Le menu contextuel du sectionneur sur la vue de traction");
  await request.getByRole("button", { name: "Generate" }).click();
  const replace = page.getByRole("alertdialog", { name: "Delete 1 test before generating?" });
  await expect(replace.getByRole("listbox", { name: "Tests to delete" }).getByRole("option")).toHaveCount(1);
  await shoot(page, "generate-replace");
  await replace.getByRole("button", { name: "Delete and generate" }).click();
  await expect(result.getByText("Claude is writing")).toBeVisible();
  await expect(result.getByRole("button", { name: "Cancel" })).toBeVisible();
  await shoot(page, "generate-running");

  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(result.getByRole("button", { name: "What Claude did" })).toHaveAttribute("aria-expanded", "false");
  await result.getByRole("button", { name: "Not written · 3" }).click();
  await expect(result.getByText(/sectionneur avec TK/).first()).toBeVisible();
  const groups = result.getByRole("region", { name: "Not written" }).getByRole("region");
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).toHaveAccessibleName("Pas de source pour le résultat attendu");
  await expect(groups.first().getByRole("listitem")).toHaveCount(2);
  await expect(groups.nth(1)).toHaveAccessibleName("Hors du périmètre demandé");
  const landed = result.getByRole("region", { name: /^Sectionneur (sans|avec) TK/ });
  await expect(landed).toHaveCount(2);
  for (const card of await landed.all())
    await expect(card.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await expect.poll(async () => (await api<unknown[]>(server.url, "tests.list")).length).toBe(before - 1 + 2);
  await expect(result.getByText("1 test not validated yet was deleted before this run.")).toBeVisible();
  await shoot(page, "generate-done");

  await result.getByRole("button", { name: "Review these tests" }).click();
  await expect(page).toHaveURL(/#\/review/);
  await expect(page.getByRole("region", { name: "Test under review" }).getByRole("heading", { level: 2 })).toHaveText(
    /^Sectionneur (sans|avec) TK/,
  );
});

// ponytail: after a generation Generate opens on « Ask for changes »; « New request » brings the form back
async function newRequest(page: Page) {
  const ask = page.getByRole("region", { name: "Ask for changes" });
  const result = page.getByRole("region", { name: "Result" });
  // ponytail: the last generation's result and its « Ask for changes » column come together, once its job is read —
  // deciding before that saw the form, then the column replaced it
  await expect(
    result
      .getByRole("heading", { name: /tests? written/ })
      .or(result.getByText("Tests appear here as Claude writes them")),
  ).toBeVisible();
  await expect(ask.or(page.getByRole("region", { name: "Request" }))).toBeVisible();
  if (await ask.isVisible()) await page.getByRole("button", { name: "New request" }).click();
}

test("a landed test opens for review with its findings", async ({ page }) => {
  await boot(page, "#/generate");
  await newRequest(page);
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await request.getByRole("button", { name: /^Generate/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete and generate" }).click();
  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 20_000 });
  await result
    .getByRole("region", { name: /^Sectionneur avec TK/ })
    .first()
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/(tests|review)\/local-[0-9a-f]{8}$/);
  const under = page.getByRole("region", { name: "Test under review" });
  await expect(under.getByRole("heading", { level: 2 })).toHaveText(/^Sectionneur avec TK/);
  await expect(under.getByRole("note").first()).toBeVisible();
});

test("after a generation, Claude is asked for changes on its tests, and its results suggest Claude actions", async ({
  page,
}) => {
  await boot(page, "#/generate");
  await newRequest(page);
  const result = page.getByRole("region", { name: "Result" });
  await page.getByRole("textbox", { name: "What should be tested?" }).fill("Le menu contextuel du sectionneur");
  await page
    .getByRole("region", { name: "Request" })
    .getByRole("button", { name: /^Generate/ })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Delete and generate/ })
    .click();
  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 30_000 });

  const ask = page.getByRole("region", { name: "Ask for changes" });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "All 2 tests" })).toHaveAttribute("aria-pressed", "true");
  const suggested = ask.getByRole("region", { name: "Suggested by the results" });
  await expect(
    suggested.getByRole("button", { name: "Write the 2 tests skipped for « Pas de source pour le résultat attendu »" }),
  ).toBeVisible();
  await expect(
    suggested.getByRole("button", { name: /^Fix the \d+ (error|warning)s? in « Sectionneur/ }).first(),
  ).toBeVisible();
  await expect(
    suggested.getByRole("region", { name: /^Generation · Le menu contextuel du sectionneur$/ }),
  ).toBeVisible();
  await expect(suggested.getByRole("region", { name: /^Test · Sectionneur/ }).first()).toBeVisible();
  await expect(suggested.getByRole("heading", { level: 3 }).nth(1)).toContainText("Generation");
  await shoot(page, "generate-ask");

  await ask
    .getByRole("textbox", { name: "What should change?" })
    .fill("Précise ce qu'il faut vérifier avant chaque action.");
  await ask.getByRole("button", { name: /^Ask Claude/ }).click();
  await expect(result.getByRole("heading", { name: /^\d+ tests? changed$/ })).toBeVisible({ timeout: 30_000 });
  await expect(ask).toBeVisible();
  await page.getByRole("button", { name: "New request" }).click();
  await expect(page.getByRole("region", { name: "Request" })).toBeVisible();
});
