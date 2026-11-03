import { join } from "node:path";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4349);
const CSV = join(import.meta.dirname, "..", "fixtures", "csv", "sectionneur-traction-l92.csv");

type Listed = { id: string; summary: string; review: string; stepCount: number };

test("the team's CSV is mapped, previewed with its warning, and imported as local drafts", async ({ page }) => {
  await boot(page, "#/import");
  await expect(page.getByRole("heading", { level: 1, name: "Import CSV" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a CSV of test steps" })).toBeVisible();
  await shoot(page, "import");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a file" }).click();
  await (await chooser).setFiles(CSV);

  const columns = page.getByRole("region", { name: "Columns" });
  await expect(columns.getByRole("combobox", { name: "Step becomes" })).toBeVisible();
  for (const c of ["Action", "Expected Result", "Exigence"])
    await expect(columns.getByRole("row", { name: new RegExp(`^${c} `) })).toContainText(c);
  await expect(columns.getByRole("row", { name: /^Source Reference / })).toContainText("Ignore");

  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByText("1 test · 5 steps")).toBeVisible();
  await expect(preview.getByText("Source Reference ignored")).toBeVisible();
  await expect(preview.getByText(/Column "Source Reference" dropped/)).toBeVisible();
  await shoot(page, "import-preview");

  const target = page.getByRole("region", { name: "Import" });
  await expect(target.getByRole("radio", { name: /^Import locally/ })).toBeChecked();
  const before = await api<Listed[]>(url, "tests.list");
  await target.getByRole("button", { name: "Import 1 test locally" }).click();

  await expect
    .poll(async () => (await api<Listed[]>(url, "tests.list")).length, { timeout: 15_000 })
    .toBe(before.length + 1);
  const after = await api<Listed[]>(url, "tests.list");
  const draft = after.find((t) => !before.some((b) => b.id === t.id));
  expect(draft?.id).toMatch(/^local-[0-9a-f]{8}$/);
  expect(draft?.review).toBe("draft");
  expect(draft?.stepCount).toBe(5);
  expect(draft?.summary).toContain("sectionneur-traction-l92");
  // ponytail: the import answer opens the first test in Tests (an imported test needs no review) — waited for, or it
  // lands after the boot below
  await expect(page).toHaveURL(new RegExp(`#/tests/${draft?.id}$`));

  await boot(page, `#/tests/${draft?.id}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("article")).toHaveCount(5);
  await expect(main.getByText("Draft", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("article", { name: "Step 1", exact: true }).getByRole("textbox", { name: "Exigence of step 1" }),
  ).toHaveValue(/EXI_MOP_SPF_510_A_20/);
});
