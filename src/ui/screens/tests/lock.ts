import { PROJECT_RUN } from "../../components/claude/turns.ts";

// ponytail: why a gesture that changes a test waits for Claude, or false — the run on this test, the run on the whole
// project, or (the editor, which any run locks) a run on another test; the one wording of the lock everywhere
export function claudeLock(running: string | null, testId: string | null | undefined, any = false): false | string {
  if (running && running === testId) return "Claude is editing this test — wait for it to finish";
  if (running === PROJECT_RUN) return "Claude is working on the whole project — wait for it to finish";
  if (any && running) return "Claude is working on another test — wait for it to finish";
  return false;
}
