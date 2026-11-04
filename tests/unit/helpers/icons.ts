// ponytail: an Icon says its name on its <svg> (data-icon); an svg drawn by hand, outside the set, reads "?" and the
// turning Spinner draws no svg at all

/** the icons drawn in an element, in document order */
export function iconsIn(el: Element | null | undefined): string[] {
  if (!el) return [];
  return [...el.querySelectorAll("svg")].map((svg) => svg.getAttribute("data-icon") ?? "?");
}

/** the first icon drawn in an element, or undefined when it draws none */
export const iconOf = (el: Element | null | undefined): string | undefined => iconsIn(el)[0];
