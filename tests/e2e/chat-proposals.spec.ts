import { api, boot, expect, mockServer, openDock, shoot, test } from "./helpers.ts";

const server = mockServer(4386);

type Ctx = { notes: string };
const learned = async () =>
  (await api<Ctx>(server.url, "contexts.show", { id: "conversations" }).catch(() => ({ notes: "" }))).notes;
const overview = async () => (await api<{ text: string }>(server.url, "docs.overviewShow")).text;
const column = async (name: string) =>
  (await api<{ name: string; description: string }[]>(server.url, "columns.list")).find((c) => c.name === name)
    ?.description;

async function ask(page: Parameters<typeof openDock>[0], q: string) {
  const dock = await openDock(page);
  await dock.getByRole("textbox", { name: "Ask about SOSIE_211_D401-1_3" }).fill(q);
  await dock.getByRole("button", { name: "Ask", exact: true }).click();
  return dock;
}

test.describe.configure({ mode: "serial" });

test("the chat proposes a change to the overview as a diff; Apply writes it, the column's Ignore writes nothing", async ({
  page,
}) => {
  await boot(page, "#/documents/SOSIE_211_D401-1_3");
  const dock = await ask(page, "Corrige la vue d'ensemble : elle oublie le poste de commande");
  const diff = dock.getByRole("list", { name: "Proposed change to How the documents fit together" });
  await expect(diff).toBeVisible({ timeout: 20_000 });
  await expect(diff.getByText("Le TCO et le PCC décrivent le même poste vu de deux places.")).toBeVisible();
  expect(await overview()).not.toContain("Le poste de commande");
  await shoot(page, "dock-proposal");
  await dock.getByRole("button", { name: "Apply" }).click();
  await expect(dock.getByText("Applied")).toBeVisible();
  await expect.poll(overview).toContain("## Le poste de commande");

  const before = await column("Expected Result");
  await dock.getByRole("textbox", { name: "Ask about SOSIE_211_D401-1_3" }).fill("Corrige la colonne Expected Result");
  await dock.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dock.getByText("Column « Expected Result »")).toBeVisible({ timeout: 20_000 });
  await dock.getByRole("button", { name: "Ignore" }).click();
  await expect(dock.getByText("Ignored")).toBeVisible();
  expect(await column("Expected Result")).toBe(before);
});

test("each answer is remembered in the « Conversations » context, unless the dock says not to", async ({ page }) => {
  await boot(page, "#/documents/SOSIE_211_D401-1_3");
  const dock = await ask(page, "Que veut dire TCO dans ce projet ?");
  await expect(dock.getByText(/Le menu contextuel d'un sectionneur dépend de son type/)).toBeVisible({
    timeout: 20_000,
  });
  await expect.poll(learned, { timeout: 20_000 }).toContain("Que veut dire TCO dans ce projet ?");
  const project = await api<{ project: { claude: { contexts: string[] } } }>(server.url, "project.info");
  expect(project.project.claude.contexts).toContain("conversations");

  await dock.getByRole("switch", { name: "Don't remember this conversation" }).click();
  await dock.getByRole("textbox", { name: "Ask about SOSIE_211_D401-1_3" }).fill("Et le PCC, à oublier ?");
  await dock.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(dock.getByText("Et le PCC, à oublier ?")).toBeVisible();
  await expect(dock.getByRole("button", { name: "Ask", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(await learned()).not.toContain("à oublier");
});

test("a long answer in Markdown is drawn: titles, lists, a table, code and a quote, no raw marks", async ({ page }) => {
  await boot(page, "#/documents/SOSIE_211_D401-1_3");
  const dock = await ask(page, "Réponds en markdown long sur le menu");
  await expect(dock.getByRole("heading", { name: "Le menu contextuel d'un sectionneur" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(dock.getByRole("table")).toBeVisible();
  await expect(dock.getByRole("group", { name: "Code" })).toContainText("ouvrir --sectionneur S12");
  await expect(dock.locator("blockquote")).toContainText("ne précisent pas l'ordre");
  await expect(dock.getByText("dépend du type", { exact: true })).toBeVisible();
  expect(await dock.locator("[aria-live]").textContent()).not.toMatch(/\*\*|#{2,3} |\| ---/);
  await shoot(page, "dock-markdown");
});
