import { createContext, useContext } from "react";
import type { ProjectJson, Review, Source, StepColumn, TraceView, XrayJson } from "../../core/types.ts";

export type Screen =
  | "documents"
  | "generate"
  | "tests"
  | "review"
  | "jobs"
  | "settings"
  | "doctor"
  | "import"
  | "setup";

export type ProjectInfo = {
  dir: string;
  project: ProjectJson;
  xray: XrayJson;
  fieldOrder?: string[];
  traces?: TraceView[];
  columns?: StepColumn[];
  counts?: { docs: number; tests: number; review: Partial<Record<Review, number>>; jobsRunning: number };
};

export type Focus = { testId: string; key?: string; summary: string; step: number | null };

export type ClaudeRun = {
  runId: string;
  changedTests: string[];
  changedSteps: Record<string, number[]>;
  testId?: string;
  review?: string;
  message?: string;
  nonce: number;
};

export type AppState = {
  info: ProjectInfo | null;
  xray: XrayJson;
  route: { screen: Screen; arg?: string };
  focus: Focus | null;
  claudeRunning: string | null;
  lastRun: ClaudeRun | null;
  testsNonce: number;
  navigate: (screen: Screen, arg?: string) => void;
  setFocus: (f: Focus | null) => void;
  setClaudeRunning: (testId: string | null) => void;
  setLastRun: (r: ClaudeRun | null) => void;
  testsChanged: () => void;
  refreshInfo: () => void;
  openSource: (s: Source) => void;
  askClaude: (scope: "test" | "step", prompt?: string) => void;
  runInDock: (job: { name: string; input: unknown; label: string; testId: string }) => void;
  openPalette: () => void;
};

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside AppContext");
  return v;
}
