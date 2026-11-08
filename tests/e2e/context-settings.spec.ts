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
  const list = section.getByRole("listbox", { name: "What Claude is given" });
  await expect(list.getByRole("option", { name: /^Generate tests/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /^House style/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /^Project rules/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /^Generation request/ })).toContainText("Built by Testimus");

  await list.getByRole("option", { name: /^Check test/ }).click();
  const card = section.getByRole("region", { name: "Check test" });
  await expect(card).toContainText(".claude/skills/check-test/SKILL.md");
  await expect(card).toContainText("Used by:");
  const shipped = (await api<Given[]>(baseURL ?? "", "claude.prompts")).find((p) => p.id === "skill:check-test");
  const text = card.getByRole("group", { name: "Text of Check test" });
  await expect(text).toContainText("name: check-test");
  expect(await text.textContent()).toBe(shipped?.text);
  await expect(card.getByRole("textbox")).toHaveCount(0);

  await section.getByRole("searchbox", { name: "Filter prompts" }).fill("define-columns");
  await expect(list.getByRole("option", { name: /^Define columns/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /^Generate tests/ })).toHaveCount(0);
  await list.getByRole("option", { name: /^Propose the smart columns/ }).click();
  await expect(section.getByRole("region", { name: "Propose the smart columns" })).toContainText(
    "Built by Testimus for each run: the parts in braces are filled then — {request}",
  );

  await section.getByRole("searchbox", { name: "Filter prompts" }).fill("");
  await list.getByRole("option", { name: /^Generate tests/ }).click();
  await shoot(page, "settings-context-e2e");
});
