// ponytail: the stage is read from the version — Alpha before 0.1.0, Beta before 1.0.0, then the number alone (stable)
export function versionLabel(v: string): string {
  const [major, minor] = v.split(".").map(Number);
  if (major >= 1) return v;
  return `${minor >= 1 ? "Beta" : "Alpha"} ${v}`;
}

export const APP_VERSION = versionLabel(__VERSION__);
