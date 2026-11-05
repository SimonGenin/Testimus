// ponytail: ids and keys in their natural order (LFRPS12-9 before LFRPS12-10) — one collator for every sort: a
// localeCompare given a locale or options builds a new one at each comparison, 25 times slower over hundreds of tests
export const natural = new Intl.Collator("en", { numeric: true }).compare;
