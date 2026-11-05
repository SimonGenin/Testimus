import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { desktop, examplePath, pickFolder } from "../../lib/desktop.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useSettings } from "../settings/machine.ts";
import { KnownProjects } from "./KnownProjects.tsx";
import { type JiraChoice, NewProject, useNewProject } from "./NewProject.tsx";
import { StepCard } from "./StepCard.tsx";
import { useProjects } from "./useProjects.ts";

export { projectFolder } from "./NewProject.tsx";

const styles = stylex.create({
  known: { display: "flex", flexDirection: "column", gap: space.s3 },
  title: { margin: 0, color: color.text },
  more: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  path: { display: "flex", alignItems: "flex-end", gap: space.s3 },
  grow: { flex: 1, minWidth: 0 },
});

// ponytail: which Jira field the new project gets — none when Jira is left out on this PC, Jira's own list when the
// access works (a key picked there exists and has Xray), else the key typed
export function useJiraChoice(): JiraChoice {
  const settings = useSettings();
  const creds = useRead("system.credentials", {});
  const off = !!settings.data?.atlassian?.skipJira;
  const usable = !off && !!creds.data?.status.jira.complete;
  const list = useRead("xray.projects", {}, { enabled: usable });
  if (off) return { kind: "off" };
  if (usable && list.data?.length) return { kind: "list", projects: list.data };
  return { kind: "typed" };
}

export function ProjectStep({ onBack, onOpened }: { onBack: () => void; onOpened?: () => void }) {
  const p = useProjects(onOpened);
  const f = useNewProject(p.root);
  const jira = useJiraChoice();
  const [path, setPath] = useState("");
  const create = async () => {
    if (f.dir && (await p.create(f.input))) f.clear();
  };
  const openFolder = async () => {
    const dir = await pickFolder("Open a project folder");
    if (dir) await p.open(dir);
  };
  return (
    <StepCard
      id="project-h"
      title="Choose a project"
      lead="A project is a folder: the documents, the tests and what Claude needs. Share it by sharing the folder."
      back={<Button variant="quiet" size="lg" icon="chevron-left" label="Back" onClick={onBack} />}
      actions={
        <Button
          variant="primary"
          size="lg"
          label="Create the project"
          disabled={!f.dir || p.busy}
          onClick={() => void create()}
        />
      }
    >
      {!p.known ? (
        <Skeleton kind="row" />
      ) : (
        p.known.length > 0 && (
          <section aria-labelledby="known-h" {...stylex.props(styles.known)}>
            <h2 id="known-h" {...stylex.props(type.titleSm, styles.title)}>
              Your projects
            </h2>
            <KnownProjects
              known={p.known}
              current={p.current}
              busy={p.busy}
              onOpen={(dir) => void p.open(dir)}
              onHide={(k) => void p.hide(k)}
              onRemove={p.remove}
            />
          </section>
        )
      )}
      <NewProject f={f} busy={p.busy} first={p.known?.length === 0} jira={jira} />
      {desktop() ? (
        <div {...stylex.props(styles.more)}>
          <Button
            variant="quiet"
            icon="folder-open"
            label="Open a project folder…"
            disabled={p.busy}
            onClick={() => void openFolder()}
          />
        </div>
      ) : (
        <Disclosure summary="Open a project folder shared with you" quiet>
          <form
            aria-label="Open a project folder"
            {...stylex.props(styles.path)}
            onSubmit={(e) => {
              e.preventDefault();
              if (path.trim()) void p.open(path.trim());
            }}
          >
            <span {...stylex.props(styles.grow)}>
              <Text
                id="proj-open"
                label="Project folder"
                placeholder={examplePath("\\\\server\\share\\Testimus\\Projects\\RATP", "/Volumes/share/Testimus/RATP")}
                value={path}
                onChange={setPath}
                spellCheck={false}
              />
            </span>
            <Button type="submit" label="Open" disabled={!path.trim() || p.busy} />
          </form>
        </Disclosure>
      )}
      {p.error && (
        <Banner tone="danger" compact title={p.failed || undefined}>
          {p.error}
        </Banner>
      )}
    </StepCard>
  );
}
