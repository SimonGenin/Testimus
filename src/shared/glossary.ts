// ponytail: Whisper reads at most 224 tokens of prompt, and the end of the passage before takes its share: the
// glossary gets 170 of them — some 60 to 80 terms. What the team or Claude writes must fit: every term written is sent
export const GLOSSARY_TOKENS = 170;

// ponytail: a careful count without the model's tokenizer — a code or an acronym breaks into about a token every
// three characters, and each term costs its comma
export const tokensOf = (term: string): number => Math.ceil(term.length / 3) + 1;

const LEAD: Record<string, string> = { fr: "Glossaire :", en: "Glossary:", de: "Glossar:", es: "Glosario:" };

export const leadOf = (language: string): string => LEAD[language.toLowerCase().slice(0, 2)] ?? "Glossary:";

export const cleanTerms = (terms: string[]): string[] => [
  ...new Set(terms.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean)),
];

// ponytail: the size of the sentence the engine is given for these terms, as promptOf (core) writes it
export function glossaryTokens(terms: string[], language: string): number {
  const clean = cleanTerms(terms);
  return clean.length ? clean.reduce((n, t) => n + tokensOf(t), tokensOf(leadOf(language))) : 0;
}
