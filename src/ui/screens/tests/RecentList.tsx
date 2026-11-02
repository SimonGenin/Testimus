import { useEffect, useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { relTime } from "../../lib/format.ts";
import { RECENT_DAYS, recentIds } from "../../lib/recent.ts";

const MAX = 6;

export function RecentList({ refs, onOpen }: { refs: LocalTestRef[]; onOpen: (id: string) => void }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("testimus:recent", on);
    return () => window.removeEventListener("testimus:recent", on);
  }, []);
  // ponytail: the cut is on the mtime the row shows — the only clock the project folder keeps
  const cut = Date.now() - RECENT_DAYS * 864e5;
  const byId = new Map(refs.map((r) => [r.id, r]));
  const list = recentIds()
    .map((id) => byId.get(id))
    .filter((r): r is LocalTestRef => !!r && r.mtime >= cut)
    .slice(0, MAX);
  if (!list.length) return null;
  return (
    <section className="recent" aria-label="Recent tests">
      <div className="recent-label">Recent</div>
      {list.map((r) => (
        <button key={r.id} type="button" className="recent-item" title={r.key ?? r.id} onClick={() => onOpen(r.id)}>
          <span className="recent-name">{r.summary || "Untitled"}</span>
          <span className="recent-time">{relTime(r.mtime)}</span>
        </button>
      ))}
    </section>
  );
}
