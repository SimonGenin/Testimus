import type { ReactNode } from "react";
import { useApp } from "../../lib/app.ts";
import { Icon, Kbd } from "../ui/index.ts";

export function ScreenHeader({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  const app = useApp();
  return (
    <header className="screenhead">
      <h1 className="h screenhead-title">{title}</h1>
      {meta ? (
        <span className="muted screenhead-meta" title={meta}>
          {meta}
        </span>
      ) : (
        <div className="spacer" />
      )}
      <div className="screenhead-actions">
        {children}
        <button type="button" className="btn palette-btn" onClick={app.openPalette}>
          <Icon name="search" />
          <span className="palette-btn-text">Search or run a command</span>
          <span className="spacer" />
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
    </header>
  );
}
