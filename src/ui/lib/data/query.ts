import {
  QueryClient,
  type QueryKey,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { CallResult, CommandInput, CommandName, CommandOutput } from "../../../core/commands/index.ts";
import { ApiError, call, project } from "./client.ts";

export type Key = readonly [project: string | null, name: string, input?: unknown];

// ponytail: what belongs to this PC rather than to a project is cached once for every project
const MACHINE = new Set<string>([
  "claude.status",
  "models.catalog",
  "models.dirs",
  "models.hardware",
  "models.list",
  "models.planDir",
  "project.list",
  "system.secrets",
  "system.settings",
  "system.version",
]);

export function isMachine(name: string): boolean {
  return MACHINE.has(name);
}

export function key<N extends CommandName>(name: N, input?: CommandInput<N>, p: string | null = project()): Key {
  const scope = isMachine(name) ? null : p;
  return input === undefined ? [scope, name] : [scope, name, input];
}

type ReadTuning = { staleTime?: number; gcTime?: number };

// ponytail: what the event bridge keeps fresh lives until it is invalidated; Jira answers are kept a while; a few
// reads are asked again on every mount; secrets and plans are never kept
const TUNING: Record<string, ReadTuning> = {
  "xray.folders": { staleTime: 5 * 60_000 },
  "xray.preconditions": { staleTime: 30 * 60_000 },
  "xray.search": { staleTime: 2 * 60_000 },
  "xray.status": { staleTime: 0 },
  "claude.status": { staleTime: 0 },
  "system.doctor": { staleTime: 0 },
  "system.secrets": { staleTime: 0, gcTime: 0 },
  "xray.plan": { staleTime: 0, gcTime: 0 },
  "models.planPack": { staleTime: 0, gcTime: 0 },
  "models.planDir": { staleTime: 0, gcTime: 0 },
  "xray.browse": { staleTime: 0, gcTime: 0 },
};

export function tuning(name: string, input?: unknown): Required<ReadTuning> {
  const dry = !!input && typeof input === "object" && (input as { dryRun?: unknown }).dryRun === true;
  const t = dry ? { staleTime: 0, gcTime: 0 } : (TUNING[name] ?? {});
  return { staleTime: t.staleTime ?? Number.POSITIVE_INFINITY, gcTime: t.gcTime ?? 5 * 60_000 };
}

const reachable = { up: true, listeners: new Set<() => void>() };

export function setReachable(up: boolean): void {
  if (reachable.up === up) return;
  reachable.up = up;
  for (const fn of reachable.listeners) fn();
}

export function isReachable(): boolean {
  return reachable.up;
}

export function useReachable(): boolean {
  return useSyncExternalStore(
    (fn) => {
      reachable.listeners.add(fn);
      return () => reachable.listeners.delete(fn);
    },
    () => reachable.up,
  );
}

// ponytail: a request that never reached the server (fetch throws a TypeError) means the server is gone; any answer,
// even an error, means it is there
async function reach<T>(work: () => Promise<T>): Promise<T> {
  try {
    const out = await work();
    setReachable(true);
    return out;
  } catch (e) {
    if (e instanceof TypeError) setReachable(false);
    else if (e instanceof ApiError) setReachable(true);
    throw e;
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
        refetchOnWindowFocus: false,
        networkMode: "always",
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

export type ReadOptions<T> = {
  enabled?: boolean;
  project?: string | null;
  keepPrevious?: boolean;
  select?: (data: T) => T;
};

export function useRead<N extends CommandName>(
  name: N,
  input?: CommandInput<N>,
  options: ReadOptions<CommandOutput<N>> = {},
): UseQueryResult<CommandOutput<N>, ApiError> {
  const p = options.project === undefined ? project() : options.project;
  const k = key(name, input, p);
  return useQuery<CommandOutput<N>, ApiError, CommandOutput<N>, QueryKey>({
    queryKey: k,
    queryFn: ({ signal }) => reach(() => call<CommandOutput<N>>(name, input ?? {}, { signal, project: p })),
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious ? (previous) => previous : undefined,
    select: options.select,
    ...tuning(name, input),
  });
}

export function read<N extends CommandName>(
  client: QueryClient,
  name: N,
  input?: CommandInput<N>,
  p: string | null = project(),
): Promise<CommandOutput<N>> {
  return client.fetchQuery<CommandOutput<N>, ApiError, CommandOutput<N>, QueryKey>({
    queryKey: key(name, input, p),
    queryFn: ({ signal }) => reach(() => call<CommandOutput<N>>(name, input ?? {}, { signal, project: p })),
    ...tuning(name, input),
  });
}

export type Prefix = readonly [name: string, input?: Record<string, unknown>];

export type Effects<N extends CommandName> = {
  // what to read again once the command succeeded; "project" (the default for a mutation): every read of the project
  invalidates?: Prefix[] | "project" | "none";
  // apply the expected result to the cache now; the returned function puts it back when the call fails
  optimistic?: (client: QueryClient, input: CommandInput<N>) => (() => void) | undefined;
  // autosaves of these reads are sent first (the command reads what they write)
  flushFirst?: Prefix[];
};

export function matches(k: QueryKey, prefix: Prefix, p: string | null): boolean {
  const [scope, name, input] = k as Key;
  if (name !== prefix[0]) return false;
  if (!isMachine(name) && scope !== p) return false;
  if (!prefix[1]) return true;
  const have = (input ?? {}) as Record<string, unknown>;
  return Object.entries(prefix[1]).every(([k2, v]) => have[k2] === v);
}

export function invalidate(client: QueryClient, prefixes: Prefix[], p: string | null = project()): Promise<void> {
  return client.invalidateQueries({ predicate: (q) => prefixes.some((x) => matches(q.queryKey, x, p)) });
}

export function invalidateProject(client: QueryClient, p: string | null = project()): Promise<void> {
  return client.invalidateQueries({ predicate: (q) => (q.queryKey as Key)[0] === p });
}

let flushHook: (prefixes: Prefix[]) => Promise<void> = async () => {};

export function setFlushHook(fn: (prefixes: Prefix[]) => Promise<void>): void {
  flushHook = fn;
}

export async function execute<N extends CommandName>(
  client: QueryClient,
  name: N,
  input: CommandInput<N>,
  effects: Effects<N> = {},
  p: string | null = project(),
): Promise<CallResult<N>> {
  if (effects.flushFirst?.length) await flushHook(effects.flushFirst);
  const undo = effects.optimistic?.(client, input);
  try {
    const out = await reach(() => call<CallResult<N>>(name, input ?? {}, { project: p }));
    const inv = effects.invalidates ?? "project";
    if (inv === "project") await invalidateProject(client, p);
    else if (inv !== "none") await invalidate(client, inv, p);
    return out;
  } catch (e) {
    undo?.();
    throw e;
  }
}

export function useCommand<N extends CommandName>(name: N, effects: Effects<N> = {}) {
  const client = useQueryClient();
  return useMutation<CallResult<N>, ApiError, CommandInput<N>>({
    mutationKey: [name],
    mutationFn: (input) => execute(client, name, input, effects),
  });
}
