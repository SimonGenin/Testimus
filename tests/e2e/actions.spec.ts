import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4351);

const DOC = "SOSIE_211_D401-1_3";
type Listed = { id: string; title: string; state: string }[];
const open = async () => (await api<Listed>(url, "actions.list", { docId: DOC })).filter((a) => a.state === "open");

test("a warning Claude can fix gets its button; the action runs from its card in Ask Claude and reverts", async ({
  page,
}) => {
  await api(url, "actions.triage", { docId: DOC, model: "haiku", effort: "low" });
  await expect.poll(async () => (await open()).length, { timeout: 15_000 }).toBe(1);

  await boot(page, `#/documents/${DOC}`);
  const side = page.getByRole("complementary", { name: /details$/ });
  const warn = side.locator(".with-cab").filter({ hasText: "Figure 41" });
  const button = warn.getByRole("button", { name: "Recover the figure from the PDF" });
  await expect(button).toBeVisible();
  await expect(side.locator(".with-cab").filter({ hasText: "Word comments" }).getByRole("button")).toHaveCount(0);
  await button.focus();
  await expect(page.getByRole("tooltip")).toContainText("Proposed by Haiku · low · during the import");
  await shoot(page, "action-button");

  await button.click();
  const dock = page.getByRole("complementary", { name: "Claude" });
  const card = dock.getByRole("region", { name: "Claude action: Recover the figure from the PDF" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${DOC} · whole document`);
  await expect(card).toContainText("Find the PDF next to the .docx");
  await expect(dock.getByRole("button", { name: "Document" })).toHaveAttribute("aria-pressed", "true");
  await shoot(page, "action-card");

  await card.getByRole("combobox", { name: "Effort" }).selectOption("high");
  await card.getByRole("button", { name: "Run action" }).click();
  await expect(card.getByText("1 file changed")).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("I read the passage the problem is about.")).toBeVisible();
  await expect(card.getByText(/ · high$/)).toBeVisible();
  await shoot(page, "action-done");
  expect((await api<{ context: string }>(url, "docs.show", { id: DOC })).context).toContain("Figures lost");
  await expect.poll(async () => (await open()).length).toBe(0);

  await card.getByRole("button", { name: /^Revert$/ }).click();
  await expect(card.getByText("Reverted")).toBeVisible();
  expect((await api<{ context: string }>(url, "docs.show", { id: DOC })).context).not.toContain("Figures lost");
});

test("a step's action shows on its Review row, in the header count, and is dismissed for good", async ({ page }) => {
  await api(url, "actions.propose", {
    problem: "Le résultat attendu ne dit pas ce que montre le menu.",
    title: "Make step 2 say what the menu shows",
    why: "§5.6.6 lists what the menu proposes.",
    plan: ["Read §5.6.6", "Rewrite the expected result"],
    scope: { kind: "step", testId: "LFRPS12-1420", step: 2 },
  });
  await boot(page, "#/review");
  const row = page.locator(".qrow-wrap").filter({ hasText: "LFRPS12-1420" });
  await expect(row.getByRole("button", { name: "Make step 2 say what the menu shows" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: /Claude actions/ })).toContainText("1");
  await shoot(page, "action-review");

  await row.getByRole("button", { name: "Make step 2 say what the menu shows" }).click();
  const dock = page.getByRole("complementary", { name: "Claude" });
  await dock.getByRole("button", { name: "Dismiss" }).click();
  await expect(row.getByRole("button", { name: "Make step 2 say what the menu shows" })).toHaveCount(0);
  const again = await api<{ ignored?: boolean }>(url, "actions.propose", {
    problem: "Le résultat attendu ne dit pas ce que montre le menu.",
    title: "Make step 2 say what the menu shows",
    why: "§5.6.6 lists what the menu proposes.",
    plan: ["Read §5.6.6"],
    scope: { kind: "step", testId: "LFRPS12-1420", step: 2 },
  });
  expect(again.ignored).toBe(true);
});
