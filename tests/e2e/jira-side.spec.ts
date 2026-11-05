import { expect, mockServer, openTest, shoot, test } from "./helpers.ts";

mockServer(4372);

test("the head moves and assigns the issue in Jira, and test.md follows", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const head = page.getByRole("region", { name: "Test" });
  await expect(head.getByRole("button", { name: "Mock Tester" })).toBeVisible();
  await expect(head.getByRole("button", { name: "2 comments" })).toBeVisible();

  await head.getByTestId("jira-status").click();
  const menu = page.getByRole("menu", { name: "Move LFRPS12-1420" });
  await expect(menu.getByRole("menuitem", { name: /Mark as done/ })).toBeVisible();
  await shoot(page, "jira-status-menu");
  await menu.getByRole("menuitem", { name: /Start testing/ }).click();
  await expect(page.getByText("LFRPS12-1420 is In Progress in Jira")).toBeVisible();
  await expect(head.getByTestId("jira-status")).toHaveText(/In Progress/);

  await head.getByTestId("jira-assignee").click();
  const people = page.getByRole("dialog", { name: "Assign LFRPS12-1420" });
  await people.getByRole("searchbox", { name: "Search people" }).fill("léa");
  await people.getByRole("option", { name: "Léa Bernard" }).click();
  await expect(page.getByText("LFRPS12-1420 is assigned to Léa Bernard")).toBeVisible();
  await expect(head.getByRole("button", { name: "Léa Bernard" })).toBeVisible();
  await page.reload();
  await expect(head.getByTestId("jira-status")).toHaveText(/In Progress/);
  await expect(head.getByRole("button", { name: "Léa Bernard" })).toBeVisible();
});

test("the Details card folds, shows Jira's version of what differs, and keeps it", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const details = page.getByRole("region", { name: "Details" });
  const description = details.getByRole("textbox", { name: "Description" });
  await description.fill("Une autre description.");
  await expect(details.getByText("Modified")).toBeVisible();
  await details.getByRole("button", { name: "Jira version" }).click();
  const was = details.getByRole("region", { name: "Details as Jira has it" });
  await expect(was.getByText(/Vérifie le menu contextuel/)).toBeVisible();
  await shoot(page, "details-jira-version");
  await details.getByRole("button", { name: "Keep Jira's version" }).click();
  await expect(description).toHaveValue(/Vérifie le menu contextuel/);
  await expect(details.getByText("Modified")).toBeHidden();

  await details.getByRole("button", { name: "Fold the details" }).click();
  await expect(description).toBeHidden();
  await expect(details.getByText(/covers LFRPS12-880/)).toBeVisible();
  await details.getByRole("button", { name: "Show the details" }).click();
  await expect(description).toBeVisible();
});

test("comments: a mention, a Claude draft sent by the person, an edit and a delete", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const card = page.getByRole("region", { name: "Comments in Jira" });
  await expect(card.getByText(/Le menu contextuel a changé en J5/)).toBeVisible();
  await expect(card.getByText("@Camille Martin")).toBeVisible();

  const box = card.getByLabel("Comment on LFRPS12-1420");
  await box.fill("Vu avec @ca");
  await card.getByRole("listbox", { name: "Mention someone" }).getByRole("option", { name: "Camille Martin" }).click();
  await expect(box).toHaveValue("Vu avec @Camille Martin ");
  await box.pressSequentially("merci");
  await box.press("Control+Enter");
  await expect(page.getByText("Jira tells Camille Martin.")).toBeVisible();
  await expect(card.getByText(/merci$/)).toBeVisible();

  await card.getByRole("button", { name: "Draft with Claude" }).click();
  const ask = page.getByRole("dialog", { name: "Draft a comment on LFRPS12-1420" });
  await ask.getByRole("button", { name: "Answer the last comment" }).click();
  await ask.getByRole("button", { name: "Draft" }).click();
  await expect(card.getByText("Drafted by Claude")).toBeVisible();
  await expect(box).toHaveValue(/^@Camille Martin d'accord/);
  await shoot(page, "comments-claude-draft");
  await card.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(card.getByText(/l'étape 3 attend maintenant/)).toBeVisible();

  const mine = card.getByRole("listitem").filter({ hasText: /merci$/ });
  await mine.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("textbox", { name: "Edit your comment" }).fill("Vu, c'est corrigé.");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Vu, c'est corrigé.")).toBeVisible();
  await card
    .getByRole("listitem")
    .filter({ hasText: "Vu, c'est corrigé." })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("alertdialog", { name: "Delete this comment?" }).getByRole("button", { name: "Delete" }).click();
  await expect(card.getByText("Vu, c'est corrigé.")).toBeHidden();
});

test("the list keeps the tests of a person, of nobody, or mine", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  const sidebar = page.getByRole("complementary", { name: "Tests" });
  await sidebar.getByTestId("assignee-filter").click();
  const menu = page.getByRole("menu", { name: "Filter by assignee" });
  await menu.getByRole("menuitemcheckbox", { name: /Camille Martin/ }).click();
  await page.keyboard.press("Escape");
  await expect(sidebar.getByRole("searchbox", { name: "Filter tests" })).toHaveValue('assignee:"Camille Martin"');
  await expect(sidebar.getByText("Disjoncteur — ouverture à distance").first()).toBeVisible();
  await expect(sidebar.getByText("Sectionneur sans TK — menu contextuel et propriétés").first()).toBeHidden();
  await shoot(page, "tests-filter-assignee");
  await sidebar.getByRole("searchbox", { name: "Filter tests" }).fill("assignee:none");
  await expect(sidebar.getByText("Disjoncteur — ouverture à distance").first()).toBeHidden();
});
