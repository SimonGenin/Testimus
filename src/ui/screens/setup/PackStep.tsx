import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { border, color, radius, space } from "../../styles/tokens.stylex.ts";
import type { Hardware } from "../settings/models/data.ts";
import { machineSummary } from "../settings/models/data.ts";
import { FitConfirm } from "../settings/models/FitConfirm.tsx";
import { FolderDialog } from "../settings/models/FolderDialog.tsx";
import { PackPlanDialog } from "../settings/models/PackPlanDialog.tsx";
import { PackCard } from "./PackCard.tsx";
import { StepCard } from "./StepCard.tsx";
import { usePackStep } from "./usePackStep.ts";

const styles = stylex.create({
  machine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s5,
    paddingBlock: space.s4,
    paddingInline: space.s5,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  facts: { flex: 1, minWidth: 0 },
  notYet: {
    flex: 1,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    color: color.textMuted,
  },
  packs: { display: "flex", flexDirection: "column", gap: space.s3 },
});

const FACTS = ["System", "Processor", "Memory", "GPU"];

function Machine({ machine }: { machine: Hardware }) {
  return (
    <div {...stylex.props(styles.facts)}>
      <Facts label="This machine" items={machineSummary(machine).map((f, i) => ({ label: FACTS[i], value: f }))} />
    </div>
  );
}

const TITLE = "How should documents be searched?";

export function PackStep({ onBack, onDone }: { onBack: () => void; onDone?: () => void }) {
  const app = useApp();
  const s = usePackStep(!!app.info, onDone);
  const a = s.actions;

  if (!app.info)
    return (
      <StepCard id="pack-h" title={TITLE}>
        <Card>
          <EmptyState
            icon="folder"
            title="Open a project first"
            text="The pack is chosen per project, on this PC."
            actions={<Button icon="chevron-left" label="Back to Project" onClick={onBack} />}
          />
        </Card>
      </StepCard>
    );

  return (
    <StepCard
      id="pack-h"
      title={TITLE}
      lead="Search finds the passages Claude cites. It runs on this PC and documents never leave it; better search means better sources, at the cost of a download. Change it any time in Settings › Models."
      back={<Button variant="quiet" size="lg" icon="chevron-left" label="Back" onClick={onBack} />}
      actions={
        <>
          <Button
            variant="quiet"
            size="lg"
            label={s.active ? `Keep ${s.active.label} for now` : "Skip for now"}
            onClick={s.done}
          />
          <Button
            variant="primary"
            size="lg"
            label={s.pack ? `Use ${s.pack.label}` : "Use this pack"}
            disabled={!s.pack || s.busy}
            loading={s.busy}
            onClick={s.use}
          />
        </>
      }
    >
      <div aria-live="polite" {...stylex.props(styles.machine)}>
        {s.machine ? (
          <Machine machine={s.machine} />
        ) : (
          <p {...stylex.props(type.compact, styles.notYet)}>
            <Icon name="cpu" />
            {s.analysing ? "Reading this machine…" : "Not analysed yet: until then, no pack is said to fit."}
          </p>
        )}
        <Button
          size="lg"
          icon={s.machine ? "refresh" : "cpu"}
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
      {a.fitAsk && (
        <FitConfirm
          name={a.fitAsk.name}
          short={a.fitAsk.short}
          fit={a.fitAsk.fit}
          processorOnly={a.fitAsk.processorOnly}
          lighter={a.fitAsk.lighter}
          onClose={() => a.setFitAsk(null)}
          onUse={() => {
            a.setFitAsk(null);
            a.fitAsk?.go();
          }}
          onLighter={() => {
            a.setFitAsk(null);
            a.fitAsk?.lighterGo();
          }}
        />
      )}
      {a.plan && (
        <PackPlanDialog
          pack={a.plan.row}
          out={a.plan.out}
          label={s.label}
          busy={a.planning}
          thenUse
          onClose={() => a.setPlan(null)}
          onConfirm={() => void a.confirmPack()}
          onChangeFolder={() => {
            const row = a.plan?.row;
            const accept = a.plan?.accept;
            a.setPlan(null);
            if (row) a.setFolder({ needMB: 0, next: () => void a.planPack(row, accept) });
          }}
        />
      )}
      {a.folder && (
        <FolderDialog
          current={null}
          needMB={a.folder.needMB}
          onClose={() => a.setFolder(null)}
          onApplied={() => {
            const next = a.folder?.next;
            a.setFolder(null);
            next?.();
          }}
        />
      )}
    </StepCard>
  );
}
