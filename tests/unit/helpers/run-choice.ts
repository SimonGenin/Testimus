import { fireEvent, screen, within } from "@testing-library/react";

type Scope = Pick<typeof screen, "queryAllByRole">;

// ponytail: model and effort are one quiet select « opus · high » whose list is a Menu (GroupSelect) — told from a
// button that only reads alike (« Context 8 · changed ») by the menu it opens
const choices = (scope: Scope) =>
  scope.queryAllByRole("button", { name: /^\S+ · \S+$/ }).filter((b) => b.getAttribute("aria-haspopup") === "menu");

export const runChoice = (scope: Scope = screen) => {
  const found = choices(scope);
  if (found.length !== 1) throw new Error(`expected one model and effort select, found ${found.length}`);
  return found[0];
};
export const noRunChoice = (scope: Scope = screen) => choices(scope)[0] ?? null;

export function pickRun(label: string, scope: Scope = screen) {
  fireEvent.click(runChoice(scope));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: label }));
}

// ponytail: the option checked in one group of the open list (« Project default · Sonnet »), the list closed again
export function checkedRun(group: "Model" | "Effort", scope: Scope = screen): string {
  const trigger = runChoice(scope);
  fireEvent.click(trigger);
  const item = within(screen.getByRole("group", { name: group })).getByRole("menuitemcheckbox", { checked: true });
  const label = item.textContent ?? "";
  fireEvent.click(trigger);
  return label;
}
