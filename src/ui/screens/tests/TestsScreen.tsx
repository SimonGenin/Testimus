import { useCallback, useEffect, useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Icon } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { errorToast } from "../../lib/toast.ts";
import { TestEditor } from "./TestEditor.tsx";
import { TestList } from "./TestList.tsx";

export function TestsScreen() {
  const app = useApp();
  const activeId = app.route.screen === "tests" ? (app.route.arg ?? "") : "";
  const [refs, setRefs] = useState<LocalTestRef[]>([]);
  const [loading, setLoading] = useState(true);
  const project = app.info?.dir;

  const reload = useCallback(async () => {
    try {
      const r = await call<LocalTestRef[]>("tests.list", {});
      const list = Array.isArray(r) ? r : [];
      setRefs(list);
      return list;
    } catch (e) {
      errorToast(e, "Could not list the tests");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the project or a run changes the tests
  useEffect(() => {
    void reload();
  }, [reload, app.testsNonce, project]);

  const open = (id: string) => app.navigate("tests", id);

  return (
    <div className="tests-screen">
      <TestList refs={refs} loading={loading} activeId={activeId} onOpen={open} onReload={reload} />
      <main className="tests-main">
        {activeId ? (
          <TestEditor
            key={activeId}
            testId={activeId}
            onOpen={open}
            onSaved={(ref) => setRefs((list) => list.map((r) => (r.id === ref.id ? { ...r, ...ref } : r)))}
          />
        ) : (
          <div className="editor-empty">
            <Icon name="tests" size={40} />
            <h2 className="h">No test open</h2>
            <p className="muted">
              Pick a test on the left. Local tests open straight from the project folder; a Jira test is pulled the
              first time you open it.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
