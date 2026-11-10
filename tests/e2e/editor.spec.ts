import type { Page } from "@playwright/test";
import { api, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const server = mockServer(4341);

type Shown = {
  test: { summary: string; review: string; steps: { id?: string; fields: Record<string, string> }[] };
};

const show = (id: string) => api<Shown>(server.url, "tests.show", { id });
const main = (page: Page) => page.getByRole("main");
const step = (page: Page, n: number) => main(page).getByRole("article", { name: `Step ${n}`, exact: true });

test("LFRPS12-1420 opens with fields in xray.json order, Data folded, smart columns as text and sources", async ({
  page,
}) => {
  await openTest(page, "LFRPS12-1420");
  await expect(main(page).getByRole("textbox", { name: "Summary" })).toHaveValue(
    "Sectionneur sans TK — menu contextuel et propriétés",
  );
  await expect(main(page).getByRole("region", { name: "Test" }).getByText("Modified", { exact: true })).toBeVisible();
  await expect(main(page).getByRole("article")).toHaveCount(5);

  const one = step(page, 1);
  const labels = await step(page, 3).locator('[data-testid="field-label"]').allInnerTexts();
  const order = ["Action", "Data", "Expected Result", "Exigence"].map((f) => labels.findIndex((l) => l.trim() === f));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  await expect(one.getByRole("button", { name: "Data", exact: true })).toHaveCount(0);
  await expect(one.getByRole("textbox", { name: "Data of step 1" })).toHaveCount(0);
  await expect(step(page, 3).getByRole("textbox", { name: "Data of step 3" })).toHaveValue(
    "Sectionneur S 12, position fermée.",
  );

  await expect(one.getByRole("textbox", { name: "Exigence of step 1" })).toHaveValue("EXI_MOP_SPF_511_A_1650");
  await expect(step(page, 2).getByRole("textbox", { name: "Exigence of step 2" })).toHaveValue(
    "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20",
  );
  await expect(one.getByRole("img", { name: "fig-40.png" })).toBeVisible();
  await expect(step(page, 3).getByRole("table")).toBeVisible();

  const chips = one.getByRole("button", { name: /^SOSIE_211_D401-1_3 / });
  await expect(chips).toHaveCount(2);
  await shoot(page, "tests-editor");
});

test("a source chip opens the passage in a Source tab beside the test, the quote highlighted", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  await step(page, 2)
    .getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.6 “Selon le type/ })
    .click();
  const source = page.getByRole("complementary").filter({ has: page.getByRole("region", { name: /^Source / }) });
  await expect(source).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Source/ })).toHaveAttribute("aria-selected", "true");
  await expect(step(page, 2)).toBeVisible();
  await expect(source.locator("mark")).toContainText("Selon le type de sectionneur, le menu contextuel diffère");
  await shoot(page, "passage");
  await source.getByRole("button", { name: "Close the source" }).click();
  await expect(source).toHaveCount(0);
});

test("editing the summary and an action saves test.md", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const summary = main(page).getByRole("textbox", { name: "Summary" });
  await summary.fill("Sectionneur sans TK — menu contextuel, propriétés");
  const action = step(page, 2).getByRole("textbox", { name: "Action of step 2" });
  await action.fill("Clic droit sur le sectionneur S 12 de la vue de traction (ligne 92).");
  await expect
    .poll(async () => (await show("LFRPS12-1420")).test.summary)
    .toBe("Sectionneur sans TK — menu contextuel, propriétés");
  await expect
    .poll(async () => (await show("LFRPS12-1420")).test.steps[1].fields.Action)
    .toBe("Clic droit sur le sectionneur S 12 de la vue de traction (ligne 92).");
  await page.reload();
  await expect(main(page).getByRole("textbox", { name: "Summary" })).toHaveValue(
    "Sectionneur sans TK — menu contextuel, propriétés",
  );
});

test("the step being edited stands out from the others, and keeps its ring while focus is elsewhere", async ({
  page,
}) => {
  await openTest(page, "LFRPS12-1420");
  const look = (n: number) =>
    // the ring is drawn by the kit Card the step's article holds (StepFrame)
    step(page, n).evaluate((el) => {
      const s = getComputedStyle(el.firstElementChild as Element);
      return `${s.borderColor} | ${s.outlineStyle} ${s.outlineColor} | ${s.boxShadow}`;
    });
  const before = await look(2);
  await step(page, 2).getByRole("textbox", { name: "Action of step 2" }).focus();
  await expect.poll(() => look(2)).not.toBe(before);
  const ring = await look(2);
  expect(ring).not.toBe(await look(1));
  await main(page).getByRole("textbox", { name: "Summary" }).focus();
  expect(await look(2)).toBe(ring);
  await step(page, 1).getByRole("textbox", { name: "Action of step 1" }).focus();
  await expect.poll(() => look(2)).toBe(before);
});

test("a step is moved, added and removed", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const before = (await show("LFRPS12-1420")).test.steps.map((s) => s.fields.Action);

  await step(page, 3).getByRole("button", { name: "Move step 3 up" }).click();
  await expect(step(page, 2).getByRole("textbox", { name: "Action of step 2" })).toHaveValue(before[2]);
  await expect
    .poll(async () => (await show("LFRPS12-1420")).test.steps.map((s) => s.fields.Action))
    .toEqual([before[0], before[2], before[1], before[3], before[4]]);

  await main(page).getByRole("button", { name: "Add step" }).click();
  await expect(main(page).getByRole("article")).toHaveCount(6);
  await step(page, 6).locator('[data-field="Action"]').getByRole("group", { name: "Insert a block" }).hover();
  await step(page, 6).locator('[data-field="Action"]').getByRole("button", { name: "Text", exact: true }).click();
  await step(page, 6).getByRole("textbox", { name: "Action of step 6" }).fill("Fermer la fenêtre Propriétés.");
  await expect.poll(async () => (await show("LFRPS12-1420")).test.steps.length).toBe(6);
  await expect
    .poll(async () => (await show("LFRPS12-1420")).test.steps[5].fields.Action)
    .toBe("Fermer la fenêtre Propriétés.");

  await step(page, 6).getByRole("button", { name: "Delete step 6" }).click();
  await expect(main(page).getByRole("article")).toHaveCount(5);
  await expect.poll(async () => (await show("LFRPS12-1420")).test.steps.length).toBe(5);

  await step(page, 2).getByRole("button", { name: "Move step 2 down" }).click();
  await expect.poll(async () => (await show("LFRPS12-1420")).test.steps.map((s) => s.fields.Action)).toEqual(before);
});

test("the push plan shows its warning, then the push runs and lands", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  await main(page).getByRole("button", { name: "Push to Jira" }).click();
  const plan = page.getByRole("alertdialog", { name: /^Push .* to Jira\?$/ });
  await expect(plan).toBeVisible();
  await expect(plan.getByText(/What will happen · \d+ operations?/)).toBeVisible();
  await expect(plan.getByRole("note").filter({ hasText: "not Validated" })).toHaveCount(0);
  await expect(plan.getByText(/review label testimus-validated/)).toBeVisible();
  await shoot(page, "push-plan");
  await plan.getByRole("button", { name: "Confirm push" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pushed LFRPS12-1420" })).toBeVisible();
  await expect(page.getByRole("alertdialog", { name: /^Push/ })).toHaveCount(0);
  await expect(main(page).getByRole("region", { name: "Test" }).getByText("In sync", { exact: true })).toBeVisible();
});

test("a test in sync with Jira has nothing to push", async ({ page }) => {
  await openTest(page, "LFRPS12-1398");
  const push = main(page).getByRole("button", { name: "Push to Jira" });
  await expect(push).toBeDisabled();
  await expect(push).toHaveAccessibleDescription("No local change since the last sync — nothing to push");
});
