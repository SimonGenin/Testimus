import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { DoctorCheck } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { ConnectAtlassian, jiraWords, type Word, xrayWords } from "../settings/ConnectAtlassian.tsx";
import { useSetting, useSettings } from "../settings/machine.ts";
import { StepCard } from "./StepCard.tsx";

const styles = stylex.create({
  rows: {
    display: "grid",
    gridTemplateColumns: "max-content max-content minmax(0, 1fr)",
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s4,
  },
  said: { color: color.textMuted, minWidth: 0 },
  note: { color: color.textSubtle },
});

const RESULT = {
  ok: { label: "Connected", tone: "success", icon: "check-circle" },
  failed: { label: "Failed", tone: "danger", icon: "x-circle" },
  missing: { label: "Not set", tone: "neutral", icon: undefined },
  unused: { label: "Not used", tone: "neutral", icon: undefined },
} as const;

type Checked = { jira: Word; xray: Word };

const wordsOf = (checks: DoctorCheck[]): Checked => ({
  jira: jiraWords(checks.find((c) => c.id === "jira")),
  xray: xrayWords(checks.find((c) => c.id === "xray")),
});

// ponytail: Jira and Xray are two halves — Jira reads the tests, Xray writes their steps (its key needs a Jira admin);
// access already saved on this PC is tested on arrival, so a person with it only reads two green rows; going on
// without Jira, or with Jira only, is a choice the system check then shows as « not used », not as a failure
export function AccessStep({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const settings = useSettings();
  const setting = useSetting();
  const creds = useRead("system.credentials", {});
  const status = creds.data?.status;
  const any = !!status && (status.jira.exists || status.xray.exists);
  const tested = useRead("system.credentials", { check: true }, { enabled: any });
  const [after, setAfter] = useState<Checked | null>(null);
  const checked: Checked | null = after ?? (tested.data ? wordsOf(tested.data.checks) : null);
  const testing = any && tested.isFetching && !after;
  const jiraOk = !!checked?.jira.ok;
  const xrayOk = !!checked?.xray.ok;
  const skip = settings.data?.atlassian ?? {};
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !creds.data || testing) return;
    if (any && !checked) return;
    opened.current = true;
    if (!jiraOk && !skip.skipJira) setOpen(true);
  });

  const go = async (patch: { skipJira?: boolean; skipXray?: boolean }) => {
    const changed = Object.entries(patch).some(([k, v]) => !!skip[k as keyof typeof skip] !== v);
    if (changed) await setting(patch);
    onContinue();
  };

  const state = (w: Word | undefined, unused: boolean | undefined) =>
    RESULT[w?.ok ? "ok" : unused ? "unused" : !w || w.untested ? "missing" : "failed"];

  return (
    <StepCard
      id="access-h"
      title="Connect to Jira and Xray"
      lead="Through your own accounts, saved in your user folder and shared with your other Atlassian tools. Jira lets Testimus read your tests; Xray lets it write their steps."
      back={<Button variant="quiet" size="lg" icon="chevron-left" label="Back" onClick={onBack} />}
      actions={
        jiraOk && xrayOk ? (
          <Button
            variant="primary"
            size="lg"
            iconAfter="chevron-right"
            label="Continue"
            onClick={() => void go({ skipJira: false, skipXray: false })}
          />
        ) : jiraOk ? (
          <>
            <span {...stylex.props(type.small, styles.note)}>Without Xray: tests are read, not pushed.</span>
            <Button
              variant="primary"
              size="lg"
              iconAfter="chevron-right"
              label="Continue with Jira only"
              onClick={() => void go({ skipJira: false, skipXray: true })}
            />
          </>
        ) : (
          <>
            <Button variant="quiet" size="lg" label="Work without Jira" onClick={() => void go({ skipJira: true })} />
            <Button
              variant="secondary"
              size="lg"
              iconAfter="chevron-right"
              label="Continue"
              disabled="Connect Jira first — or work without it"
              onClick={onContinue}
            />
          </>
        )
      }
    >
      {!creds.data || testing ? (
        <div role="status" aria-busy="true" aria-label="Testing the access saved on this PC">
          <Skeleton lines={2} />
          <Loading read="system.credentials" />
        </div>
      ) : (
        <>
          {jiraOk && !after && (
            <Banner tone="info" compact>
              Access already saved on this PC was found and tested.
            </Banner>
          )}
          <Card sunken>
            <div role="status" aria-live="polite" {...stylex.props(styles.rows)}>
              <Badge {...state(checked?.jira, skip.skipJira)} />
              <span {...stylex.props(type.compact, type.strong)}>Jira</span>
              <span {...stylex.props(type.compact, styles.said)}>
                {checked?.jira.ok
                  ? checked.jira.text
                  : skip.skipJira
                    ? "Left out: you chose to work without Jira."
                    : "Your site, your email and an API token."}
              </span>
              <Badge {...state(checked?.xray, skip.skipXray || skip.skipJira)} />
              <span {...stylex.props(type.compact, type.strong)}>Xray</span>
              <span {...stylex.props(type.compact, styles.said)}>
                {checked?.xray.ok
                  ? checked.xray.text
                  : "Optional — an API key made by a Jira admin, to push the steps."}
              </span>
            </div>
          </Card>
          <Disclosure summary={jiraOk && xrayOk ? "Change the access" : "Connect"} open={open} onOpenChange={setOpen}>
            <ConnectAtlassian
              saveVariant={jiraOk ? "secondary" : "primary"}
              onResult={(r) => setAfter(wordsOf(r.checks))}
            />
          </Disclosure>
        </>
      )}
    </StepCard>
  );
}
