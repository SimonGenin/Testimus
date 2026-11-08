import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4443);

const RUN = "recette-j5-sectionneurs";

test("the Run screen lists the runs, and a test is run step by step, saved, then the next one opens", async ({
  page,
}) => {
  await boot(page, "#/run");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Run/ }).click();
  const runs = page.getByRole("navigation", { name: "Runs" });
  await expect(runs.getByRole("group", { name: "In progress" })).toContainText("Recette J5 — Sectionneurs");
  await expect(runs.getByRole("group", { name: "Finished" })).toContainText("Recette J4 — Traction");
  const run = page.getByRole("region", { name: "Run Recette J5 — Sectionneurs" });
  await expect(run.getByRole("progressbar", { name: "Run progress" })).toHaveAttribute("aria-valuenow", "67");
  await shoot(page, "run/run-list");

  await run.getByRole("button", { name: "Continue — next test not run" }).click();
  await expect(page).toHaveURL(new RegExp(`#/run/${RUN}/LFRPS12-1398$`));
  const test1398 = page.getByRole("region", { name: /^Test Disjoncteur/ });
  await test1398.getByRole("group", { name: "Step 1" }).getByRole("button", { name: "NOK" }).click();
  await test1398.getByRole("textbox", { name: "What happened" }).fill("Le disjoncteur reste fermé.");
  const verdict = page.getByRole("radiogroup", { name: "Result of the test" });
  await expect(verdict.getByRole("radio", { name: /Problem/ })).toHaveAttribute("aria-checked", "true");
  const side = page.getByRole("complementary", { name: "Comments and questions" });
  await side.getByRole("textbox", { name: "Add a comment or a question" }).fill("Poste 3, image du 6/11.");
  await side.getByRole("button", { name: "Add" }).click();
  await expect(side.locator("p", { hasText: "Poste 3, image du 6/11." })).toBeVisible();
  await shoot(page, "run/run-test");
  await page.getByRole("button", { name: /^Save the result/ }).click();

  await expect(run).toBeVisible();
  const row = run.getByRole("row", { name: /Disjoncteur/ });
  await expect(row).toContainText("Problem");
  await expect(row).toContainText("0 OK · 1 NOK");
  await expect(row).toContainText("1 comment");
  await expect(run.getByRole("button", { name: "Every test has a result" })).toBeDisabled();
  await expect(runs.getByRole("group", { name: "Finished" })).toContainText("Recette J5 — Sectionneurs");
});

test("the keyboard marks the steps: J / K move, O and N mark, Ctrl+Enter saves", async ({ page }) => {
  await boot(page, `#/run/${RUN}/LFRPS12-1420`);
  const t = page.getByRole("region", { name: /^Test Sectionneur sans TK/ });
  await expect(
    t.getByRole("group", { name: "Step 1" }).getByRole("button", { name: "OK", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("j");
  await page.keyboard.press("n");
  await expect(t.getByRole("group", { name: "Step 2" }).getByRole("button", { name: "NOK" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("o");
  await expect(
    t.getByRole("group", { name: "Step 2" }).getByRole("button", { name: "OK", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("n");
  await expect(t.getByRole("group", { name: "Step 2" }).getByRole("button", { name: "NOK" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const verdict = page.getByRole("radiogroup", { name: "Result of the test" });
  await expect(verdict.getByRole("radio", { name: /Passed/ })).toHaveAttribute("aria-checked", "true");
  await verdict.getByRole("radio", { name: /Problem/ }).click();
  await expect(verdict.getByRole("radio", { name: /Problem/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Control+Enter");
  await expect(page).not.toHaveURL(/LFRPS12-1420$/);
  await boot(page, `#/run/${RUN}`);
  const row = page.getByRole("table", { name: "Tests of the run" }).getByRole("row", { name: /Sectionneur sans TK/ });
  await expect(row).toContainText("Problem");
  await expect(row).toContainText("4 OK · 1 NOK");
});

test("New run… freezes the tests of a folder into a run of its own", async ({ page }) => {
  await boot(page, "#/run");
  await page.getByRole("button", { name: "New run…" }).click();
  const dialog = page.getByRole("dialog", { name: "New run" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Essai sur site — Bobigny");
  await dialog.getByRole("textbox", { name: "Version under test" }).fill("2.4.0");
  await expect(dialog).toContainText("3 tests:");
  await shoot(page, "run/run-new");
  await dialog.getByRole("button", { name: "Make the run (3 tests)" }).click();
  await expect(page).toHaveURL(/#\/run\/essai-sur-site-bobigny$/);
  const run = page.getByRole("region", { name: "Run Essai sur site — Bobigny" });
  await expect(run.getByRole("table", { name: "Tests of the run" }).getByRole("row")).toHaveCount(4);
  await expect(run).toContainText("Version under test 2.4.0");
});
