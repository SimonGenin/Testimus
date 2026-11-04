import { fireEvent, screen, within } from "@testing-library/react";

type Scope = Pick<typeof screen, "getByRole" | "queryByRole">;

// ponytail: model and effort are one quiet select « opus · high » whose list is a Menu (GroupSelect)
export const runChoice = (scope: Scope = screen) => scope.getByRole("button", { name: /^\S+ · \S+$/ });
export const noRunChoice = (scope: Scope = screen) => scope.queryByRole("button", { name: /^\S+ · \S+$/ });

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
