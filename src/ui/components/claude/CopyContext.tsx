import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { project } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, fontSize, radius, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Select } from "../ui/Select.tsx";
import { useContextWrite } from "./contexts.ts";

type Listed = { id: string; name: string };
type Projects = { projects: { dir: string; name: string; exists: boolean }[] };

const styles = stylex.create({
  box: {
    margin: 0,
    borderWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  muted: { fontSize: fontSize.small, color: color.textSubtle },
  acts: { display: "flex", justifyContent: "flex-end", gap: space.s2 },
});

// ponytail: contexts live in each project folder; this brings one over from another project in two picks
export function CopyContext({ onCopied }: { onCopied: (id: string) => void }) {
  const here = project() ?? "";
  const write = useContextWrite();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [pick, setPick] = useState("");
  const listed = useRead("project.list", {}, { enabled: open });
  const projects = (((listed.data as unknown as Projects | undefined)?.projects ?? []) as Projects["projects"]).filter(
    (p) => p.exists && p.dir !== here,
  );
  const theirsRead = useRead("contexts.list", { from }, { enabled: open && !!from });
  const theirs = from && theirsRead.data !== undefined ? (((theirsRead.data as unknown) ?? []) as Listed[]) : null;
  const chosen = pick && theirs?.some((c) => c.id === pick) ? pick : (theirs?.[0]?.id ?? "");

  if (!open)
    return (
      <Button size="sm" variant="quiet" icon="copy" label="Copy from another project…" onClick={() => setOpen(true)} />
    );

  const copy = () =>
    write("contexts.copy", { from, id: chosen })
      .then((c) => {
        setOpen(false);
        setFrom("");
        if (c) onCopied(c.id);
      })
      .catch((e) => errorToast(e, "Could not copy the context"));

  return (
    <fieldset {...stylex.props(styles.box)}>
      {projects.length ? (
        <Select
          label="Project to copy from"
          size="sm"
          block
          placeholder="Choose a project…"
          value={from || null}
          options={projects.map((p) => ({ value: p.dir, label: p.name }))}
          onChange={(v) => {
            setFrom(v);
            setPick("");
          }}
        />
      ) : (
        <span {...stylex.props(styles.muted)}>No other project opened yet</span>
      )}
      {theirs &&
        (theirs.length ? (
          <Select
            label="Context to copy"
            size="sm"
            block
            value={chosen}
            options={theirs.map((c) => ({ value: c.id, label: c.name || c.id }))}
            onChange={setPick}
          />
        ) : (
          <span {...stylex.props(styles.muted)}>That project has no context</span>
        ))}
      <span {...stylex.props(styles.acts)}>
        <Button size="sm" variant="quiet" label="Cancel" onClick={() => setOpen(false)} />
        <Button size="sm" label="Copy" disabled={!from || !chosen} onClick={() => void copy()} />
      </span>
    </fieldset>
  );
}
