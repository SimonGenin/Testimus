import { useEffect, useRef } from "react";
import { useApp } from "../../lib/app.ts";
import { toast } from "../../lib/toast.ts";
import { canRestart, restartApp, restartHint, useUpdates } from "../../lib/updates.ts";

// ponytail: told once per page and version — « 0.4.0 is available » with What's new (Settings › Changelog, where its
// lines and Update are), then « 0.4.0 is installed » with Restart; letting the toast go is « later »
export function UpdateNotice({ booted }: { booted: boolean }) {
  const app = useApp();
  const updates = useUpdates(booted);
  const told = useRef(new Set<string>());
  const u = updates.data;

  useEffect(() => {
    if (!u?.installed) return;
    if (u.pending && !told.current.has(`installed ${u.pending}`)) {
      told.current.add(`installed ${u.pending}`);
      told.current.add(`available ${u.pending}`);
      toast({
        tone: "success",
        title: `Testimus ${u.pending} is installed`,
        detail: restartHint(u.pending),
        action: canRestart()
          ? { label: "Restart", run: restartApp }
          : { label: "What's new", run: () => app.navigate("settings", "changelog") },
        left: 60,
      });
      return;
    }
    const v = u.available ? u.latest?.version : undefined;
    if (!v || told.current.has(`available ${v}`)) return;
    told.current.add(`available ${v}`);
    toast({
      tone: "neutral",
      title: `Testimus ${v} is available`,
      detail: `You have ${u.current}.`,
      action: { label: "What's new", run: () => app.navigate("settings", "changelog") },
      left: 30,
    });
  }, [u, app.navigate]);

  return null;
}
