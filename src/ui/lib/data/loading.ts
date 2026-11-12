import { type Query, type QueryClient, QueryClientContext } from "@tanstack/react-query";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import { project } from "./client.ts";
import { matches } from "./query.ts";

// ponytail: what a skeleton stands for, in words — the one vocabulary of the « Loading … » line under every skeleton,
// one entry per read a screen waits on behind one
const WORDS = {
  "claude.preview": "what the run is given",
  "claude.prompts": "what Claude is given",
  "claude.status": "Claude's status",
  "contexts.list": "the contexts",
  "contexts.show": "the context",
  "docs.list": "the documents",
  "docs.planStart": "what starting the documents takes",
  "docs.overviewShow": "how the documents fit together",
  "docs.remove": "the tests that cite it",
  "docs.show": "the document",
  "gen.show": "the generation",
  "issue.comments": "the comments",
  "issue.people": "the people",
  "jobs.activity": "what Claude did",
  "jobs.list": "the jobs",
  "jobs.show": "the job",
  "media.disk": "the room the videos take",
  "media.estimate": "what the video will take",
  "media.glossary": "the glossary of the transcription",
  "media.measures": "the measures of the transcription models",
  "media.proposals": "the corrections proposed",
  "media.report": "what the new transcription changes",
  "media.show": "the video",
  "media.transcript": "what is said in the video",
  "models.catalog": "the model catalog",
  "models.hardware": "this machine",
  "models.packs": "the packs",
  "models.speech": "the transcription models",
  "models.usage": "who uses what",
  "project.info": "the project",
  "project.list": "the projects",
  "rag.passage": "the passage",
  "rag.spaces": "the vector spaces",
  "review.queue": "the review queue",
  "runs.history": "the other runs of this test",
  "runs.list": "the test runs",
  "runs.show": "the test run",
  "search.all": "the results",
  "system.credentials": "the access saved on this PC",
  "system.doctor": "the system check",
  "system.secrets": "the credentials",
  "tests.list": "the tests",
  "tests.show": "the test",
  "xray.folders": "the Jira folders",
  "xray.plan": "the push plan",
} as const satisfies Partial<Record<CommandName, string>>;

export type LoadingRead = keyof typeof WORDS;

export const loadingWords = (read: LoadingRead): string => WORDS[read];

const owners = new Map<LoadingRead, symbol[]>();
const listeners = new Set<() => void>();
const told = () => {
  for (const fn of listeners) fn();
};

// ponytail: one line per read on the page — a list and the pane beside it both waiting on the documents say it once,
// under the first that showed its skeleton
export function useLoadingTurn(read: LoadingRead): boolean {
  const [me] = useState(() => Symbol(read));
  useEffect(() => {
    owners.set(read, [...(owners.get(read) ?? []), me]);
    told();
    return () => {
      const left = (owners.get(read) ?? []).filter((s) => s !== me);
      if (left.length) owners.set(read, left);
      else owners.delete(read);
      told();
    };
  }, [read, me]);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => owners.get(read)?.[0] === me,
  );
}

// ponytail: Try again asks again the reads of that command a screen still waits on (no answer yet) — the request under
// way is dropped first: a refetch alone would only wait on it
export async function retryRead(client: QueryClient, read: LoadingRead): Promise<void> {
  const p = project();
  const predicate = (q: Query) => matches(q.queryKey, [read], p) && q.state.data === undefined;
  await client.cancelQueries({ predicate });
  await client.refetchQueries({ type: "active", predicate });
}

// ponytail: the kit's Loading is drawn in the catalogue too, where no read runs
export function useRetryRead(read: LoadingRead): () => void {
  const client = useContext(QueryClientContext);
  return () => {
    if (client) void retryRead(client, read);
  };
}
