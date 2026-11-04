import { render } from "@testing-library/react";
import { Icon, type IconName } from "../../../src/ui/components/ui/Icon.tsx";
import { ICONS } from "../../../src/ui/components/ui/icons.ts";

const shapes = new Map<string, IconName>();

function shapesByMarkup(): Map<string, IconName> {
  if (shapes.size) return shapes;
  for (const name of Object.keys(ICONS) as IconName[]) {
    const host = document.createElement("div");
    const r = render(<Icon name={name} />, { container: host });
    const markup = host.querySelector("svg")?.innerHTML ?? "";
    if (!shapes.has(markup)) shapes.set(markup, name);
    r.unmount();
  }
  return shapes;
}

// ponytail: the design icons drawn inside an element, by name and in order — an svg that is not one of the set (a
// spinner) reads "?"; two names drawn the same (review and eye) read as the first
export function iconsIn(el: Element | null | undefined): string[] {
  if (!el) return [];
  const known = shapesByMarkup();
  return [...el.querySelectorAll("svg")].map((svg) => known.get(svg.innerHTML) ?? "?");
}
