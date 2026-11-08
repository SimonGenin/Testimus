import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Screen } from "../lib/app.ts";
import { onAnyEvent } from "../lib/data/events.ts";
import { execute } from "../lib/data/query.ts";
import { toast } from "../lib/toast.ts";
import { parseRoute } from "./routes.ts";

// ponytail: what the shell does with the event stream — the core is told of a failed job (it decides whether Claude
// looks at it), a finished check is announced. Files changed on disk are read again by the data layer alone
// (lib/data/events.ts): the old « tests changed » signal at each burst drew the whole shell again and dropped the
// tests list read in flight
export function useShellEvents(navigate: (screen: Screen) => void): void {
  const client = useQueryClient();
  const go = useRef(navigate);
  go.current = navigate;
  useEffect(
    () =>
      onAnyEvent((e) => {
        if (e.type !== "status") return;
        if (e.job.status === "failed")
          void execute(client, "actions.triageFailed", { jobId: e.job.id }, { invalidates: "none" }).catch(() => {});
        if (e.job.kind === "check" && e.job.status === "done") {
          const tests = ((e.job.result as { tests?: { errors: number; warnings: number }[] })?.tests ?? []).filter(
            Boolean,
          );
          const n = tests.filter((t) => t.errors + t.warnings > 0).length;
          toast({
            tone: "claude",
            title: `Check finished — ${tests.length} test${tests.length === 1 ? "" : "s"}, ${n} with findings`,
            action:
              parseRoute(window.location.hash).screen === "review"
                ? undefined
                : { label: "Open Review", run: () => go.current("review") },
          });
        }
      }),
    [client],
  );
}
