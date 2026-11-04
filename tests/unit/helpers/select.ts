import { fireEvent, within } from "@testing-library/react";

// ponytail: a kit Select is a button whose text is the chosen option; its list (the kit's Menu) exists while it is open
export function openList(select: HTMLElement): HTMLElement {
  if (select.getAttribute("aria-expanded") !== "true") fireEvent.click(select);
  const list = document.getElementById(select.getAttribute("aria-controls") ?? "");
  if (!list) throw new Error(`the list of ${select.getAttribute("aria-label") ?? "the select"} did not open`);
  return list;
}

export function choose(select: HTMLElement, option: string | RegExp): void {
  fireEvent.click(within(openList(select)).getByRole("option", { name: option }));
}
