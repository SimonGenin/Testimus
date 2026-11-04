import { expect, mockServer, openTest, shoot, test } from "./helpers.ts";

mockServer(4342, { TESTIMUS_MOCK_MAX_ATTACHMENT: "100" });

test("a push stops at the oversized attachment, says what to do, and resumes from that operation", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const sidebar = page.getByRole("complementary", { name: "Tests" });
  await sidebar.getByRole("button", { name: "Clone" }).click();
  await expect(page).toHaveURL(/#\/tests\/local-[0-9a-f]{8}$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("img", { name: "fig-40.png" })).toBeVisible();

  await main.getByRole("button", { name: "Push to Jira" }).click();
  const plan = page.getByRole("dialog", { name: "Push plan" });
  await expect(plan.getByText(/^Create test in Jira/)).toBeVisible();
  await expect(plan.getByText("Embed 1 image in step 1")).toBeVisible();
  await plan.getByRole("button", { name: "Confirm push" }).click();

  const progress = page.getByRole("dialog", { name: /^(Pushing .* to Jira|Push stopped at operation \d+ of 4)$/ });
  const stopped = progress.getByRole("heading", { name: /^Push stopped at operation \d+ of 4$/ });
  await expect(stopped).toBeVisible();
  const at = Number(((await stopped.textContent()) ?? "").match(/operation (\d+)/)?.[1]);
  await expect(progress.getByText(/Attachment .* over the .* Jira accepts/)).toBeVisible();
  await expect(progress.getByText("What to do:")).toBeVisible();
  await expect(progress.getByText("Done", { exact: true })).toHaveCount(at - 1);
  await expect(progress.getByText("Failed", { exact: true })).toHaveCount(1);
  await expect(progress.getByText("Not started", { exact: true })).toHaveCount(4 - at);
  await shoot(page, "push-stopped");

  await progress.getByRole("button", { name: `Resume from operation ${at}` }).click();
  await expect(progress.getByRole("heading", { name: `Push stopped at operation ${at} of 4` })).toBeVisible();
  await expect(progress.getByText("Done", { exact: true })).toHaveCount(at - 1);
  await progress.getByRole("button", { name: "Close" }).last().click();
  await expect(progress).toBeHidden();
  await expect(page).toHaveURL(/#\/tests\/(local-[0-9a-f]{8}|LFRPS12-\d+)$/);
});
