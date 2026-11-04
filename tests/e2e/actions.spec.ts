import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4351);

// ponytail: below ~1300px beside the Claude dock the document list and the settings fold into drawers
test.use({ viewport: { width: 1920, height: 1080 } });

const DOC = "SOSIE_211_D401-1_3";
type Listed = { id: string; title: string; state: string }[];
const open = async () => (await api<Listed>(url, "actions.list", { docId: DOC })).filter((a) => a.state === "open");

test("a problem Claude can fix becomes a card in the Actions tab only; it runs with the suggested model and reverts", async ({
  page,
}) => {
  await api(url, "actions.triage", { docId: DOC, model: "haiku", effort: "low" });
  await expect.poll(async () => (await open()).length, { timeout: 15_000 }).toBe(1);

  await boot(page, `#/documents/${DOC}`);
  const side = page.getByRole("region", { name: / details$/ });
  await expect(side.getByText(/Figure 41/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover the figure from the PDF" })).toHaveCount(0);

  const dock = page.getByRole("complementary", { name: "Claude" });
  const rail = dock.getByRole("button", { name: "Open Claude" });
  if (await rail.isVisible()) {
    await expect(dock.getByText("1", { exact: true })).toBeVisible();
    await rail.click();
  }
  await expect(dock.getByRole("region", { name: /Claude action/ })).toHaveCount(0);
  const tab = dock.getByRole("tab", { name: /^Actions/ });
  await expect(tab).toContainText("1");
  await tab.click();
  const card = dock.getByRole("region", { name: "Claude action: Recover the figure from the PDF" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${DOC} · whole document`);
  await card.getByRole("button", { name: "Show" }).click();
  await expect(card).toContainText("Find the PDF next to the .docx");
  await expect(card).toContainText("Every Testimus command");
  await expect(card).toContainText("Proposed by Haiku · low · during the import");
  await expect(card.getByRole("button", { name: "opus · high" })).toBeVisible();
  await shoot(page, "action-card");

  await card.getByRole("button", { name: "Run", exact: true }).click();
  const ran = dock.getByRole("region", { name: "Claude action: Recover the figure from the PDF" });
  await expect(ran.getByText("1 file changed")).toBeVisible({ timeout: 20_000 });
  await expect(ran.getByText("I read the passage the problem is about.")).toBeVisible();
  await expect(ran.getByText("opus · high")).toBeVisible();
  await shoot(page, "action-done");
  expect((await api<{ context: string }>(url, "docs.show", { id: DOC })).context).toContain("Figures lost");
  await expect.poll(async () => (await open()).length).toBe(0);

  await ran.getByRole("button", { name: /^Revert$/ }).click();
  await expect(ran.getByText("Reverted")).toBeVisible();
  expect((await api<{ context: string }>(url, "docs.show", { id: DOC })).context).not.toContain("Figures lost");

  await dock.getByRole("tab", { name: "Documents" }).click();
  await expect(dock.getByRole("region", { name: /Claude action/ })).toHaveCount(0);
});

test("a step's action is a card in the Actions tab, not on its Review row, and is dismissed for good", async ({
  page,
}) => {
  await api(url, "actions.propose", {
    problem: "Le résultat attendu ne dit pas ce que montre le menu.",
    title: "Make step 2 say what the menu shows",
    why: "§5.6.6 lists what the menu proposes.",
    plan: ["Read §5.6.6", "Rewrite the expected result"],
    scope: { kind: "step", testId: "LFRPS12-1420", step: 2 },
    model: "sonnet",
    effort: "medium",
  });
  await boot(page, "#/review");
  await expect(
    page.getByRole("complementary", { name: "Review queue" }).getByRole("option").filter({ hasText: "LFRPS12-1420" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Make step 2 say what the menu shows" })).toHaveCount(0);

  await boot(page, "#/tests");
  const dock = page.getByRole("complementary", { name: "Claude" });
  const rail = dock.getByRole("button", { name: "Open Claude" });
  if (await rail.isVisible()) await rail.click();
  await dock.getByRole("tab", { name: /^Actions/ }).click();
  const card = dock.getByRole("region", { name: "Claude action: Make step 2 say what the menu shows" });
  await card.getByRole("button", { name: "Show" }).click();
  await expect(card.getByRole("button", { name: "sonnet · medium" })).toBeVisible();
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(card).toHaveCount(0);
  const again = await api<{ ignored?: boolean }>(url, "actions.propose", {
    problem: "Le résultat attendu ne dit pas ce que montre le menu.",
    title: "Make step 2 say what the menu shows",
    why: "§5.6.6 lists what the menu proposes.",
    plan: ["Read §5.6.6"],
    scope: { kind: "step", testId: "LFRPS12-1420", step: 2 },
  });
  expect(again.ignored).toBe(true);
});
