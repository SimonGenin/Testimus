import { Badge, ReviewBadge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { List } from "../../../components/ui/List.tsx";
import type { ListItemProps } from "../../../components/ui/ListItem.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const LONG = "Sectionneur sans TK — menu contextuel, propriétés, états ouvert et fermé, commande locale et à distance";

function One({ label, item, selected = false }: { label: string; item: ListItemProps; selected?: boolean }) {
  return (
    <List label={label} items={[label]} getKey={(k) => k} renderItem={() => item} selected={selected ? label : null} />
  );
}

export const section: KitSection = {
  name: "ListItem",
  family: "Collections",
  file: "ListItem.tsx",
  summary:
    "One row of a List: indent and twisty, lead, title with inline badges, a meta line, actions shown on hover or focus in place of the trail. The List gives it its role, its selection and the keyboard.",
  states: () => (
    <States>
      <Cell label="title · lead · trail" column>
        <One label="one" item={{ title: "SOSIE_211_D401-1_4", lead: <Icon name="file" />, trail: "128 p." }} />
      </Cell>
      <Cell label="meta line (two lines) · inline badges" column>
        <One
          label="two"
          item={{
            title: "Sectionneur avec TK",
            badges: <Badge label="Generated" tone="claude" icon="claude" size="sm" />,
            meta: (
              <>
                <span>LFRPS12-1421</span>
                <ReviewBadge state="validated" size="sm" />
              </>
            ),
          }}
        />
      </Cell>
      <Cell label="selected" column>
        <One label="selected" selected item={{ title: "Sectionneurs", lead: <Icon name="folder" />, trail: "48" }} />
      </Cell>
      <Cell label="hover · actions replace the trail" column>
        <One
          label="hover"
          item={{
            title: "Disjoncteurs",
            lead: <Icon name="folder" />,
            trail: "31",
            debugState: "hover",
            actions: <Button iconOnly size="xs" variant="quiet" icon="download" label="Pull the whole folder" />,
          }}
        />
      </Cell>
      <Cell label="focus (inset ring)" column>
        <One label="focus" item={{ title: "Signalisation", debugState: "focus", trail: "433" }} />
      </Cell>
      <Cell label="tree node · depth 2, closed" column>
        <One label="tree" item={{ title: "Sectionneurs", depth: 2, expanded: false, lead: <Icon name="folder" /> }} />
      </Cell>
      <Cell label="disabled · danger" column>
        <One label="disabled" item={{ title: "Disjoncteur — ouverture", meta: "LFRPS12-1398", disabled: true }} />
        <One label="danger" item={{ title: "Delete the local copy", lead: <Icon name="trash" />, danger: true }} />
      </Cell>
      <Cell label="long title (ellipsis, full title as tooltip)" column>
        <One label="long" item={{ title: LONG, tooltip: LONG, meta: "LFRPS12-1420" }} />
      </Cell>
    </States>
  ),
};
