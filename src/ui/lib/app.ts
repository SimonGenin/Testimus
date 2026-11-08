import { createContext, useContext } from "react";
import type { ChatProblem, ColumnLayout, ProjectJson, Review, Source, StepColumn, XrayJson } from "../../core/types.ts";

export type Screen =
  | "documents"
  | "generate"
  | "tests"
  | "review"
  | "run"
  | "jobs"
  | "settings"
  | "doctor"
  | "setup"
  | "kit";

// ponytail: First launch › Project reached from the app (the project menu's « All projects… », the palette, an empty
// screen): opening a project there goes back to the app, where the first launch walks on to Search
export const SETUP_FROM_APP = "project/app";

export type ProjectInfo = {
  dir: string;
  project: ProjectJson;
  xray: XrayJson;
  fieldOrder?: string[];
  columns?: StepColumn[];
  counts?: {
    docs: number;
    tests: number;
    review: Partial<Record<Review, number>>;
    awaiting?: number;
    jobsRunning: number;
  };
};

export type Focus = { testId: string; key?: string; summary: string; step: number | null };

export type ClaudeRun = {
  runId: string;
  changedTests: string[];
  changedSteps: Record<string, number[]>;
  testId?: string;
  review?: string;
  message?: string;
  /** the run just reverted (its runId): the dock marks its card */
  reverted?: string;
  nonce: number;
};

export type AppState = {
  info: ProjectInfo | null;
  xray: ColumnLayout;
  route: { screen: Screen; arg?: string };
  focus: Focus | null;
  claudeRunning: string | null;
  lastRun: ClaudeRun | null;
  testsNonce: number;
  navigate: (screen: Screen, arg?: string) => void;
  setFocus: (f: Focus | null) => void;
  // the dock's run, until its job is known (jobId) — the lock itself is read from the running jobs
  setClaudeRunning: (testId: string | null, jobId?: string) => void;
  setLastRun: (r: ClaudeRun | null) => void;
  testsChanged: () => void;
  refreshInfo: () => void;
  closeProject: () => void;
  /** a source to show; from: the test (and step) that cites it, so the document it opens can lead back there */
  openSource: (s: Source, from?: SourceFrom) => void;
  askClaude: (scope: "test" | "step", prompt?: string) => void;
  runInDock: (job: { name: string; input: unknown; label: string; testId: string }) => void;
  /** a problem the app met, asked to Claude in the dock: it explains the cause and may propose an action */
  askAbout: (problem: ChatProblem, label?: string) => void;
  openPalette: () => void;
};

export type SourceFrom = { test: string; step?: number; sources?: Source[] };

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside AppContext");
  return v;
}
