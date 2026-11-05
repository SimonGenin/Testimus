export type DesktopVersion = { shell: string; electron: string; chrome: string };

export type FileFilter = { name: string; extensions: string[] };

export type TestimusDesktop = {
  version(): Promise<DesktopVersion>;
  pickFolder(o: { title: string; defaultPath?: string }): Promise<string | null>;
  pickFiles(o: { title: string; filters: FileFilter[]; multiple: boolean }): Promise<string[]>;
  pathOf(file: File): string;
  reveal(path: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  setProgress(fraction: number | null): Promise<void>;
  notify(o: { title: string; body: string }): Promise<boolean>;
  setAlwaysOnTop(on: boolean): Promise<boolean>;
  relaunch(): Promise<boolean>;
  onOpenProject(cb: (dir: string) => void): () => void;
};

export type ShellPage = {
  details(): Promise<{ message: string; lines: string[]; logDir: string }>;
  restart(): Promise<void>;
  openLogs(): Promise<void>;
};

export const BRIDGE_CALLS = [
  "version",
  "pickFolder",
  "pickFiles",
  "reveal",
  "openExternal",
  "setProgress",
  "notify",
  "setAlwaysOnTop",
  "relaunch",
] as const;

export const SHELL_CALLS = ["details", "restart", "openLogs"] as const;

export const CHANNEL = {
  hello: "testimus:hello",
  openProject: "testimus:open-project",
  call: (name: string) => `testimus:${name}`,
} as const;

declare global {
  interface Window {
    testimusDesktop?: TestimusDesktop;
    testimusShell?: ShellPage;
  }
}
