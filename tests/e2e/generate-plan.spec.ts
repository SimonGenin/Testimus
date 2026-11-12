import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const server = mockServer(4376, { TESTIMUS_MOCK_CLAUDE_STEP_MS: "40" });

type Shown = { tests: string[]; plan?: { tests: { summary: string }[] } };
type Job = { id: string; kind: string; status: string; result?: { generation?: string; tests?: string[] } };

const ANSWER = "Non, seulement Propriétés";

test("a request of 3 tests stops at the plan, an answer revises it, « Write » writes the 3 tests in 2 theme sub-folders", async ({
  page,
}) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  const docs = request.getByRole("button", { name: "Narrow…" });
  await expect(request.getByText(/^All documents \(\d+\)$/)).toBeVisible();
  await expect(docs).toHaveAttribute("aria-expanded", "false");
  await expect(request.getByRole("list", { name: "Documents in scope" })).toHaveCount(0);
  await shoot(page, "generate-picker");
  await expect(request.getByRole("checkbox", { name: "Review the plan before writing" })).toBeChecked();
  await request.getByRole("textbox", { name: "Xray folder" }).fill("/Traction");
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le menu contextuel du sectionneur");
  await request.getByRole("button", { name: /^Generate/ }).click();
  const replace = page.getByRole("alertdialog");
  await replace.or(result.getByText("Claude is writing")).first().waitFor();
  if (await replace.isVisible()) await replace.getByRole("button", { name: /^Delete and generate/ }).click();

  const plan = result.getByRole("region", { name: "Plan" });
  await expect(plan.getByRole("heading", { name: "3 tests in 2 themes" })).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByText(/Le menu d'un sectionneur avec TK en défaut/).first()).toBeVisible();
  await expect(plan.getByText("Same sections as 3")).toBeVisible();
  const planned = await api<Job[]>(server.url, "jobs.list");
  const generation = planned.find((j) => j.kind === "generate")?.result?.generation ?? "";
  expect(generation).not.toBe("");
  expect((await api<Shown>(server.url, "gen.show", { generation })).tests).toEqual([]);
  await shoot(page, "generate-plan");

  await plan.getByRole("radio", { name: ANSWER }).check();
  await plan.getByRole("button", { name: "Revise the plan" }).click();
  await expect(plan.getByText(/^3. Menu réduit, TK en défaut/)).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByText(/Le menu d'un sectionneur avec TK en défaut/)).toHaveCount(0);
  await expect(plan.getByText(/Settled \(1\)/)).toBeVisible();

  await plan.getByRole("button", { name: "Write the 3 tests" }).click();
  const tree = result.getByRole("tree", { name: "Tests of the generation" });
  await expect(tree.getByRole("treeitem", { name: /^Sectionneurs sans TK/ })).toBeVisible({ timeout: 30_000 });
  await shoot(page, "generate-writing-themes");
  await expect(result.getByRole("heading", { name: "3 tests written", exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(tree.getByRole("treeitem", { name: /^Sectionneurs avec TK/ })).toBeVisible();
  await shoot(page, "generate-result-themes");

  const shown = await api<Shown>(server.url, "gen.show", { generation });
  expect(shown.tests).toHaveLength(3);
  for (const id of shown.tests) {
    const t = await api<{ test: { folder: string; description: string } }>(server.url, "tests.show", { id });
    expect(t.test.folder).toMatch(/^\/Traction\/Sectionneurs (sans|avec) TK$/);
    expect(t.test.description).toContain(ANSWER);
    await api(server.url, "review.set", { id, decision: "validate" });
  }
  await page.goto("/#/tests");
  const side = page.getByRole("complementary", { name: "Tests" });
  await expect(side.getByRole("treeitem", { name: /^Sectionneurs sans TK/ })).toBeVisible();
  await expect(side.getByRole("treeitem", { name: /^Sectionneurs avec TK/ })).toBeVisible();
});
