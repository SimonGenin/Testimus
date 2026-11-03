import type { Action } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { Icon } from "../ui/index.ts";

export function ActionCount({ actions }: { actions: Action[] }) {
  const app = useApp();
  if (!actions.length) return null;
  return (
    <button
      type="button"
      className="cab"
      title={actions.map((a) => `• ${a.title}`).join("\n")}
      onClick={() => app.openAction(actions)}
    >
      <Icon name="claude" className="cab-logo" />
      <span className="cab-text">Claude actions</span>
      <span className="cab-count">{actions.length}</span>
    </button>
  );
}
