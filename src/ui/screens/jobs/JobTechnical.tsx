import * as stylex from "@stylexjs/stylex";
import type { Job } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { type } from "../../components/ui/type.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  id: { display: "inline-flex", alignItems: "center", gap: space.s2 },
});

// ponytail: the ids a job is known by on disk and on the command line — for a person who asks (a bug report, the
// CLI), folded, each beside its name; nowhere else on the page
export function JobTechnical({ job }: { job: Job }) {
  return (
    <Disclosure quiet summary="Technical details">
      <Facts
        size="sm"
        label="Technical details"
        items={[
          {
            label: "Job",
            value: (
              <span {...stylex.props(styles.id)}>
                <span {...stylex.props(type.code)}>{job.id}</span>
                <Button
                  variant="quiet"
                  size="xs"
                  icon="copy"
                  iconOnly
                  label="Copy the job id"
                  onClick={() => void navigator.clipboard?.writeText(job.id).catch(() => {})}
                />
              </span>
            ),
          },
          !!job.subject.trim() &&
            job.subject !== "{}" && {
              label: "Works on",
              value: <span {...stylex.props(type.code)}>{job.subject}</span>,
            },
          !!job.parentId && { label: "Inside", value: <span {...stylex.props(type.code)}>{job.parentId}</span> },
          !!job.cause && { label: "After", value: <span {...stylex.props(type.code)}>{job.cause.jobId}</span> },
        ]}
      />
    </Disclosure>
  );
}
