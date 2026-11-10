import { api, boot, expect, shoot, test } from "./helpers.ts";

type Given = { id: string; group: string; origin: string; text: string };

test("Settings › Context lists what Claude is given; a skill opens in full, read only", async ({ page, baseURL }) => {
  await boot(page, "#/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("option", { name: "Context", exact: true })
    .click();
  const section = page.getByRole("region", { name: "Context", exact: true });
  await expect(section.getByRole("heading", { name: "Context", exact: true })).toBeVisible();
  const list = section.getByRole("tree", { name: "What Claude is given" });
  const head = (label: string) => list.getByRole("treeitem", { name: new RegExp(`^${label}\\s*\\d+$`) });
  await expect(list.getByRole("treeitem", { name: /^Generate tests/ })).toBeVisible();
  await expect(head("Team skills")).toHaveAttribute("aria-expanded", "false");
  await head("Team skills").click();
  await expect(list.getByRole("treeitem", { name: /^House style/ })).toBeVisible();
  await expect(list.getByRole("treeitem", { name: /^Project rules/ })).toBeVisible();
  await expect(list.getByRole("treeitem", { name: /^Generation request/ })).toContainText("Run");
  await expect(head("Check and fix")).toHaveAttribute("aria-expanded", "false");
  await expect(list.getByRole("treeitem", { name: /^Check test/ })).toHaveCount(0);

  await head("Check and fix").click();
  await list.getByRole("treeitem", { name: /^Check test\s*Skill/ }).click();
  const card = section.getByRole("region", { name: "Check test", exact: true });
  await expect(card).toContainText(".claude/skills/check-test/SKILL.md");
  await expect(card).toContainText("Used by");
  const shipped = (await api<Given[]>(baseURL ?? "", "claude.prompts")).find((p) => p.id === "skill:check-test");
  const text = card.getByRole("group", { name: "Text of Check test" });
  await expect(text).toContainText("name: check-test");
  expect(await text.textContent()).toBe(shipped?.text);
  await expect(card.getByRole("textbox")).toHaveCount(0);

  await section.getByRole("searchbox", { name: "Filter what Claude is given" }).fill("define-columns");
  await expect(list.getByRole("treeitem", { name: /^Define columns/ })).toBeVisible();
  await expect(list.getByRole("treeitem", { name: /^Generate tests/ })).toHaveCount(0);
  await list.getByRole("treeitem", { name: /^Propose the smart columns/ }).click();
  const run = section.getByRole("region", { name: "Propose the smart columns", exact: true });
  await expect(run).toContainText("Built by Testimus for each run: the parts in braces are filled then — {request}");
  await expect(run.getByRole("table", { name: "What Claude is asked" })).toContainText("Define columns");
  await expect(run.getByRole("table", { name: "What goes with it" })).toContainText("Project rules");

  await section.getByRole("searchbox", { name: "Filter what Claude is given" }).fill("");
  await head("Generation").click();
  await list.getByRole("treeitem", { name: /^Generate tests/ }).click();
  await shoot(page, "settings-context-e2e");
});
