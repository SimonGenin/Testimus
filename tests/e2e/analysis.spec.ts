import type { Page } from "@playwright/test";
import { api, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

const server = mockServer(4561);
const ID = "LFRPS12-1420";

type Shown = { analysis: { proposals: { id: string; title: string; state: string }[] } | null };
type Steps = { test: { steps: { sources: { column?: string; item?: string }[] }[] } };

const pane = (page: Page) => page.getByRole("complementary", { name: "Analysis against the documents" });

async function analyze(page: Page) {
  await openTest(page, ID);
  await page.getByRole("button", { name: /^Analysis/ }).click();
  await expect(pane(page)).toContainText("Nothing changes until you accept it");
  await pane(page).getByRole("button", { name: "Analyze" }).click();
  await expect(pane(page).getByRole("radio", { name: /To decide/ })).toBeVisible({ timeout: 20_000 });
}

test("Claude's analysis sits beside the test: its proposals by step, each accepted or rejected on its own", async ({
  page,
}) => {
  await analyze(page);
  const p = pane(page);
  const shown = (await api<Shown>(server.url, "analysis.show", { id: ID })).analysis;
  const open = shown?.proposals.filter((x) => x.state === "open") ?? [];
  expect(open.length).toBeGreaterThan(2);
  await expect(p.getByRole("radio", { name: /To decide/ })).toContainText(String(open.length));
  await expect(p.getByRole("region", { name: "Step 1" })).toBeVisible();
  await expect(p.getByRole("region", { name: /^After step/ })).toContainText("New step");
  await expect(p).toContainText("How Claude read the columns");
  await shoot(page, "tests/analysis");

  const step1 = p.getByRole("region", { name: "Step 1" });
  await step1.getByRole("button", { name: "Accept" }).first().click();
  await expect(p.getByRole("radio", { name: /Accepted/ })).toContainText("1");
  const steps = (await api<Steps>(server.url, "tests.show", { id: ID })).test.steps;
  expect(steps[0].sources.some((s) => s.column === "Exigence" && s.item === "EXI_MOP_SPF_511_A_1650")).toBe(true);
  await expect(page.getByText("Reloaded from disk")).toHaveCount(0);

  const step5 = p.getByRole("region", { name: "Step 5" });
  const removal = step5.locator("[data-proposal]").filter({ hasText: "Retirer le step 5" });
  await removal.getByRole("button", { name: "Reject" }).click();
  await expect(p.getByRole("radio", { name: /Rejected/ })).toContainText("1");
  expect((await api<Steps>(server.url, "tests.show", { id: ID })).test.steps).toHaveLength(5);

  await p.getByRole("radio", { name: /Rejected/ }).click();
  await p.getByRole("button", { name: "Reconsider" }).click();
  await expect(p.getByRole("radio", { name: /Rejected/ })).toContainText("0");
});

test("a step's group leads to the step, and the analysis is still there when the pane opens again", async ({
  page,
}) => {
  await openTest(page, ID);
  await page.getByRole("button", { name: /^Analysis/ }).click();
  const p = pane(page);
  if (!(await p.getByRole("radio", { name: /To decide/ }).isVisible())) {
    await p.getByRole("button", { name: "Analyze" }).click();
    await expect(p.getByRole("radio", { name: /To decide/ })).toBeVisible({ timeout: 20_000 });
  }
  await p.getByRole("button", { name: "Step 3", exact: true }).click();
  await expect(page.getByRole("main").getByRole("article", { name: "Step 3" })).toBeInViewport();
  await p.getByRole("button", { name: "Close the analysis" }).click();
  await expect(p).toHaveCount(0);
  await page.getByRole("button", { name: /^Analysis/ }).click();
  await expect(pane(page).getByRole("radio", { name: /To decide/ })).toBeVisible();
});
