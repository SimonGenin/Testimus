import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";

// ponytail: a test changed in Jira since the last pull offers the same three choices in Tests and in Review — Compare
// (what is yours, in the editor), Replace with Jira's version (the one confirmation), Keep mine (the push plan, which
// says it replaces their change)
export function JiraChanged({
  replacing,
  locked = false,
  keepOff = false,
  onCompare,
  onReplace,
  onKeepMine,
}: {
  replacing?: boolean;
  /** Claude's lock: Replace and Keep mine wait */
  locked?: false | string;
  /** why Keep mine (the push) is off, beyond Claude */
  keepOff?: false | string;
  onCompare: () => void;
  onReplace: () => void;
  onKeepMine: () => void;
}) {
  return (
    <Banner
      tone="warning"
      icon="cloud"
      title="Changed in Jira since your pull"
      actions={
        <>
          <Button size="sm" label="Compare" onClick={onCompare} />
          <Button
            size="sm"
            icon="download"
            label="Replace with Jira's version"
            loading={replacing}
            disabled={locked}
            onClick={onReplace}
          />
          <Button size="sm" variant="quiet" label="Keep mine" disabled={locked || keepOff} onClick={onKeepMine} />
        </>
      }
    >
      Someone changed this test in Jira after your last pull. Choose which version to keep before you push: push is
      refused until you choose — or until you push anyway and replace their change on purpose.
    </Banner>
  );
}
