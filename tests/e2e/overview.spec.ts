import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { api, boot, expect, mockServer, shoot, test, waitForJob } from "./helpers.ts";

const server = mockServer(4553);

test.use({ viewport: { width: 1600, height: 1000 } });

type Shown = {
  enabled: boolean;
  inEveryRun: boolean;
  exists: boolean;
  text: string;
  updatedAt?: string;
  updatedAfter?: string;
  changed: { modified: string[]; added: string[]; removed: string[] };
};

function client(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "testimus-e2e-overview-"));
  for (const n of names) writeFileSync(join(dir, `${n}.docx`), sampleDocx());
  return dir;
}

// ponytail: the sections of the text, by the document they speak of (or their title)
const sections = (text: string) =>
  Object.fromEntries(
    text
      .split(/^## /m)
      .slice(1)
      .map((s) => {
        const [head, ...rest] = s.split("\n");
        return [/<!-- doc (\S+) -->/.exec(head)?.[1] ?? head.trim(), rest.join("\n")];
      }),
  );

async function updated(after?: string): Promise<Shown> {
  let shown: Shown | null = null;
  await expect
    .poll(
      async () => {
        shown = await api<Shown>(server.url, "docs.overviewShow");
        return !!shown.updatedAt && shown.updatedAt !== after;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return shown as unknown as Shown;
}

test("after an import Claude writes how the documents fit together, then updates only what a later import touches", async ({
  page,
}) => {
  await api(server.url, "project.set", { claude: { overview: { enabled: true, inEveryRun: false } } });
  const first = await api<{ jobId: string }>(server.url, "docs.addFolder", {
    dir: client(["SPEC_OA_01_00", "SPEC_OB_01_00"]),
    describeFigures: false,
  });
  await waitForJob(server.url, first.jobId);
  const one = await updated();
  expect(one.updatedAfter).toBe("Its first writing");
  const before = sections(one.text);
  expect(Object.keys(before)).toEqual(expect.arrayContaining(["SPEC_OA", "SPEC_OB", "Le corpus", "Les liens"]));

  await boot(page, "#/documents");
  const list = page.getByRole("region", { name: "Document list" });
  const row = list.getByRole("option", { name: /How the documents fit together/ });
  await expect(row).toContainText("By Claude");
  await row.click();
  await expect(page).toHaveURL(/#\/documents\/~overview$/);
  const pane = page.getByRole("region", { name: "How the documents fit together" });
  await expect(pane.getByRole("heading", { name: "Le corpus" })).toBeVisible();
  await expect(pane.getByText("docs/OVERVIEW.md", { exact: true })).toBeVisible();

  const third = await api<{ jobId: string }>(server.url, "docs.addFolder", {
    dir: client(["SPEC_OC_01_00"]),
    describeFigures: false,
  });
  await waitForJob(server.url, third.jobId);
  const two = await updated(one.updatedAt);
  expect(two.updatedAfter).toMatch(/^Import of « /);
  const after = sections(two.text);
  for (const [k, v] of Object.entries(before))
    if (k !== "Le corpus" && k !== "Les liens") expect(after[k], `section ${k} kept word for word`).toBe(v);
  expect(after.SPEC_OC).toBeTruthy();
  expect(two.changed.modified).toEqual(["Le corpus", "Les liens"]);
  expect(two.changed.added).toHaveLength(1);
  const banner = pane.getByText(/^Last update changed 2 sections \(« Le corpus », « Les liens »\) and added 1/);
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await shoot(page, "docs-overview-e2e");
  await pane.getByRole("button", { name: "Show changes" }).click();
  const diff = page.getByRole("dialog", { name: "Changes of the last update" });
  await expect(diff.getByRole("img", { name: "Added" }).first()).toBeVisible();
  await diff.getByRole("button", { name: "Close" }).first().click();

  const every = pane.getByRole("switch", { name: "Give it to every Claude run" });
  await expect(every).not.toBeChecked();
  await every.click();
  await expect(every).toBeChecked();
  await expect.poll(async () => (await api<Shown>(server.url, "docs.overviewShow")).inEveryRun).toBe(true);
  const given = await api<{ id: string; text: string }[]>(server.url, "claude.prompts");
  expect(given.find((g) => g.id === "file:docs/OVERVIEW.md")?.text).toContain("<!-- doc SPEC_OC -->");
});
