import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4380);

test("a sentence becomes tracked ids: Claude proposes, the card previews, Generate and Settings show the new kind", async ({
  page,
}) => {
  await boot(page, "#/documents");
  const bar = page.getByRole("group", { name: "Tracked ids" });
  await expect(bar.getByRole("button", { name: /^Requirement · 5 ids/ })).toBeVisible();
  await shoot(page, "traces-documents");

  await bar.getByRole("button", { name: "Track ids…" }).click();
  const dialog = page.getByRole("dialog", { name: "Track ids from the documents" });
  await dialog
    .getByRole("textbox", { name: "What should Testimus pick out of the documents?" })
    .fill("les numéros de figure");
  await dialog.getByRole("button", { name: "Ask Claude" }).click();
  const card = dialog.getByRole("region", { name: "What will be tracked" });
  await expect(card.getByLabel("Name of one id")).toHaveValue("Figure", { timeout: 15_000 });
  await expect(card.getByText("1 id")).toBeVisible();
  await expect(card.getByText("Figure 40", { exact: true })).toBeVisible();
  await expect(card.getByText("« Figure » is not a step field in Xray yet")).toBeVisible();
  await shoot(page, "traces-proposal");

  await card.getByLabel("Pattern").fill("(oops");
  await expect(card.getByText(/Unterminated group|unterminated/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Track these ids" })).toBeDisabled();
  await card.getByLabel("Pattern").fill(String.raw`\bFigure \d+`);
  await dialog.getByRole("button", { name: "Track these ids" }).click();
  await expect(dialog).toBeHidden();
  await expect(bar.getByRole("button", { name: /^Figure · 1 id/ })).toBeVisible();
  const traces = await api<{ id: string; column: string }[]>(url, "traces.list");
  expect(traces.map((t) => [t.id, t.column])).toEqual([
    ["requirement", "in-xray"],
    ["figure", "local"],
  ]);

  await page.goto(`${url}/#/generate`);
  const request = page.getByRole("region", { name: "Request" });
  const columns = request.getByRole("list", { name: "Step columns" });
  const figure = columns.getByRole("listitem").filter({ hasText: "Figure" });
  await expect(figure.getByText("Id list")).toBeVisible();
  await expect(figure.getByText("Local only")).toBeVisible();
  await expect(figure.getByText("Every Figure id of the picked scope is to be covered.")).toBeVisible();
  await shoot(page, "traces-generate");

  await page.goto(`${url}/#/settings/columns`);
  const section = page.locator("#settings-columns");
  await expect(section.getByRole("listitem").filter({ hasText: "Figure" }).getByText("Local only")).toBeVisible();
  await shoot(page, "traces-settings");

  await section.getByRole("listitem").filter({ hasText: "Figure" }).getByRole("button", { name: "Coverage" }).click();
  const cov = page.getByRole("dialog", { name: "Coverage of the tracked ids" });
  await expect(cov.getByText("0 of 1 Figure id")).toBeVisible();
  await expect(
    cov.getByRole("list", { name: "Ids not covered" }).getByText("Figure 40", { exact: true }),
  ).toBeVisible();
  await cov.getByRole("button", { name: /^Requirement/ }).click();
  await expect(cov.getByText("5 of 5 Requirement ids")).toBeVisible();
  await cov.getByRole("button", { name: /^Covered/ }).click();
  await expect(cov.getByRole("list", { name: "Ids covered" }).getByRole("listitem")).toHaveCount(5);
  await shoot(page, "traces-coverage");
  await cov.getByRole("button", { name: /^Figure/ }).click();
  await cov.getByRole("button", { name: "Generate tests for the 1 missing id" }).click();
  await expect(page).toHaveURL(/#\/generate$/);
  await expect(page.getByText(/From Coverage: 1 figure id/)).toBeVisible();
});
