const LANGUAGES: Record<string, string> = {
  fr: "French",
  en: "English",
  de: "German",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};

export const languageName = (code: string) => LANGUAGES[code.toLowerCase()] ?? code;
