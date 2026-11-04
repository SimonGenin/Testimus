import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { desktop, pickFolder } from "../../lib/desktop.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { KnownProjects } from "./KnownProjects.tsx";
import { NewProject, useNewProject } from "./NewProject.tsx";
import { StepCard } from "./StepCard.tsx";
import { useProjects } from "./useProjects.ts";

export { projectFolder } from "./NewProject.tsx";

const styles = stylex.create({
  known: { display: "flex", flexDirection: "column", gap: space.s3 },
  title: { margin: 0, color: color.text },
  more: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});

export function ProjectStep({ onBack, onOpened }: { onBack: () => void; onOpened?: () => void }) {
  const p = useProjects(onOpened);
  const f = useNewProject(p.root);
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
      <NewProject f={f} busy={p.busy} first={p.known?.length === 0} />
      {desktop() && (
        <div {...stylex.props(styles.more)}>
          <Button
            variant="quiet"
            icon="folder-open"
            label="Open a project folder…"
            disabled={p.busy}
            onClick={() => void openFolder()}
          />
        </div>
      )}
      {p.error && (
        <Banner tone="danger" compact>
          {p.error}
        </Banner>
      )}
    </StepCard>
  );
}
