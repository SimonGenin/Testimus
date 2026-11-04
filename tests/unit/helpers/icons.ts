import { ICONS, type IconName } from "../../../src/ui/components/ui/icons.ts";

// ponytail: an Icon is an <svg> rebuilt from ICONS, with no name on it — it is recognised by its shapes
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const part = (tag: string, attrs: [string, unknown][]) =>
  `${tag} ${attrs
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join(" ")}`;
const SHAPES = (Object.entries(ICONS) as [IconName, (typeof ICONS)[IconName]][]).map(
  ([name, parts]) =>
    [
      name,
      parts
        .map(([tag, attrs]) =>
          part(
            tag,
            Object.entries(attrs).map(([k, v]) => [kebab(k), v]),
          ),
        )
        .join("|"),
    ] as const,
);
const shapeOf = (svg: Element) =>
  [...svg.children]
    .map((c) =>
      part(
        c.tagName.toLowerCase(),
        [...c.attributes].map((a) => [a.name, a.value]),
      ),
    )
    .join("|");

/** the icons drawn in an element, in document order; `eye` and `review` draw the same shape and both read `eye` */
export function iconsIn(el: Element): string[] {
  return [...el.querySelectorAll("svg")].map((svg) => SHAPES.find(([, s]) => s === shapeOf(svg))?.[0] ?? "?");
}

/** the first icon drawn in an element, or undefined when it draws none */
export const iconOf = (el: Element): string | undefined => iconsIn(el)[0];
