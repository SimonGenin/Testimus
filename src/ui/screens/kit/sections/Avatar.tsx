import { Avatar } from "../../../components/ui/Avatar.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Avatar",
  family: "Status",
  file: "Avatar.tsx",
  note: "Added with the Jira side of a test (assignee, comments): no kit piece drew a person before.",
  summary:
    "A person, as initials on a tint: the assignee in a test's head and in the tests list, the author of a Jira comment, a name in the people menu. Always beside the written name (it is hidden from screen readers); the tint follows the Jira account, so a person has the same colour everywhere.",
  states: () => (
    <States>
      <Cell label="md (a comment, the head)">
        <Avatar name="Camille Martin" id="mock-account-2" />
        <Avatar name="Léa Bernard" id="mock-account-3" />
        <Avatar name="Hugo Petit" id="mock-account-4" />
        <Avatar name="Simon" id="mock-account-1" />
      </Cell>
      <Cell label="sm (a list row, a menu)">
        <Avatar size="sm" name="Camille Martin" id="mock-account-2" />
        <Avatar size="sm" name="Léa Bernard" id="mock-account-3" />
      </Cell>
      <Cell label="nobody (unassigned)">
        <Avatar />
        <Avatar size="sm" />
      </Cell>
    </States>
  ),
};
