import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useApp } from "../../lib/app.ts";
import { border, color, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import type { Hardware } from "../settings/models/data.ts";
import { machineSummary } from "../settings/models/data.ts";
import { FolderDialog } from "../settings/models/FolderDialog.tsx";
import { PackCard } from "./PackCard.tsx";
import { StepCard } from "./StepCard.tsx";
import { usePackStep } from "./usePackStep.ts";

const styles = stylex.create({
  machine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s4,
    padding: space.s4,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  facts: {
    flex: 1,
    margin: 0,
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: space.s4,
    rowGap: space.s1,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  fact: { display: "contents" },
  term: { color: color.textMuted },
  value: { margin: 0, color: color.text },
  notYet: { flex: 1, margin: 0, color: color.textMuted, fontSize: fontSize.compact, lineHeight: lineHeight.compact },
  packs: { display: "flex", flexDirection: "column", gap: space.s3 },
});

const FACTS = ["System", "Processor", "Memory", "GPU"];

function Machine({ machine }: { machine: Hardware }) {
  return (
    <dl aria-label="This machine" {...stylex.props(styles.facts)}>
      {machineSummary(machine).map((f, i) => (
        <div key={f} {...stylex.props(styles.fact)}>
          <dt {...stylex.props(styles.term)}>{FACTS[i]}</dt>
          <dd {...stylex.props(styles.value)}>{f}</dd>
        </div>
      ))}
    </dl>
  );
}

const TITLE = "Choose how documents are searched";

export function PackStep({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const s = usePackStep(!!app.info);

  if (!app.info)
    return (
      <StepCard
        id="pack-h"
        title={TITLE}
        lead="Open or create a project first: the pack is chosen per project, on this PC."
        back={<Button icon="chevron-left" label="Back to Project" onClick={onBack} />}
      />
    );

  return (
    <StepCard
      id="pack-h"
      title={TITLE}
      lead="Search runs on this PC and documents never leave it. Analyse the machine to see which packs it runs and the most it runs comfortably; you can change it any time in Settings › Models."
      back={<Button variant="quiet" icon="chevron-left" label="Back" onClick={onBack} />}
      actions={
        <>
          <Button variant="quiet" label="Skip for now" onClick={s.done} />
          <Button
            variant="primary"
            label={s.pack ? `Use ${s.pack.label}` : "Use this pack"}
            disabled={!s.pack || s.busy}
            loading={s.busy}
            onClick={() => void s.use()}
          />
        </>
      }
    >
      <div aria-live="polite" {...stylex.props(styles.machine)}>
        {s.machine ? (
          <Machine machine={s.machine} />
        ) : (
          <p {...stylex.props(styles.notYet)}>Not analysed yet: until then, no pack is said to fit.</p>
        )}
        <Button
          icon="refresh"
          label={s.analysing ? "Analysing…" : s.machine ? "Analyse again" : "Analyse my machine"}
          loading={s.analysing}
          disabled={!s.packs}
          onClick={() => void s.analyse()}
        />
      </div>
      {s.error ? (
        <Banner tone="danger" title="The packs could not be read">
          {s.error}
        </Banner>
      ) : !s.packs ? (
        <div role="status" aria-busy="true" aria-label="Loading the packs" {...stylex.props(styles.packs)}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} kind="block" />
          ))}
        </div>
      ) : (
        <div role="radiogroup" aria-label="Search packs" {...stylex.props(styles.packs)}>
          {s.packs.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              chosen={s.chosen === p.id}
              suggested={p.id === s.suggested}
              analysed={!!s.machine}
              label={s.label}
              onChoose={s.setChosen}
            />
          ))}
        </div>
      )}
      {s.folderNeed !== null && (
        <FolderDialog current={null} needMB={s.folderNeed} onClose={s.closeFolder} onApplied={s.folderChosen} />
      )}
    </StepCard>
  );
}
