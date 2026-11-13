import { Banner } from "../../../components/ui/Banner.tsx";
import { Timeline } from "../../../components/ui/Timeline.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Timeline",
  family: "Status",
  file: "Timeline.tsx",
  summary:
    "The steps of a job or the phases of a Claude run, in order: done, running, failed, skipped, waiting — each an icon whose word is read out. A step holds what it did, a banner or the processes it ran.",
  note: "Added to the kit on purpose: a job's steps, « Claude's work » and Generate's run were three timelines drawn by hand.",
  states: () => (
    <States>
      <Cell label="every state · time · note" wide column>
        <Timeline
          label="Steps of the job"
          items={[
            { key: "read", state: "done", title: "Read the documents", time: "0:12" },
            { key: "plan", state: "running", title: "Plan the tests", time: "0:42", note: "2 processes" },
            { key: "write", state: "waiting", title: "Write the tests" },
            { key: "push", state: "skipped", title: "Push to Jira", note: "not asked" },
          ]}
        />
      </Cell>
      <Cell label="failed · nested processes (compact)" wide column>
        <Timeline
          label="Steps of the push"
          items={[
            { key: "summary", state: "done", title: "Update the summary and labels", time: "0:01" },
            {
              key: "steps",
              state: "failed",
              title: "Replace the steps",
              time: "0:03",
              children: (
                <>
                  <Banner tone="danger" compact>
                    Jira did not answer — try again in a minute.
                  </Banner>
                  <Timeline
                    compact
                    label="Processes"
                    items={[
                      { key: "p1", state: "done", title: "step 1 · ok", time: "09:15:02" },
                      { key: "p2", state: "failed", title: "step 2 · 400 Bad Request", time: "09:15:04" },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Cell>
      <Cell label="claude (Claude's work)" wide column>
        <Timeline
          tone="claude"
          label="Claude's work"
          items={[
            { key: "search", state: "done", title: "Searched the documents", note: "6 passages" },
            { key: "write", state: "running", title: "Writing step 3" },
          ]}
        />
      </Cell>
    </States>
  ),
};
