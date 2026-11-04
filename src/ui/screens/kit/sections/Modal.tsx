import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { color, size, space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  well: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: `calc(${size.modalSm} - ${space.s11} * 3)`,
    padding: space.s7,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
});

const none = () => {};
const formActions = (
  <>
    <Button label="Cancel" />
    <Button variant="primary" label="Open" />
  </>
);

export const section: KitSection = {
  name: "Modal",
  family: "Overlays",
  file: "Modal.tsx",
  summary:
    "A task to finish or abandon before going back: a push plan, a form, a manager, a confirmation. The confirmation is an option (confirm), the only place a danger button lives; the lightbox, the palette and the narrow window's side panes are options too (flush, frameless, drawer).",
  note: "Keyboard: the focus goes into the dialog (Cancel for a danger confirmation, the verb for another one), Tab and Shift+Tab stay inside, Escape and Close cancel except while busy, and the focus goes back to what opened it.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Scrim (`color-scrim`) · panel (`color-surface-raised`, `radius-4`, `shadow-3`) · head: optional icon, title (16 px semibold, a question for a confirmation), optional subtitle, close · body (scrolls; the head and foot stay) · foot: an optional note on the left (« Saved in ~/.atlassian », « Do not close while pushing »), buttons on the right, primary last.",
    },
    {
      head: "Sizes",
      text: "`sm` 440 px (confirmations) · `md` 640 px (forms, plans) · `lg` 960 px (Contexts, the palette, the lightbox frame).",
    },
    {
      head: "Confirmation option",
      text: "`sm`, an icon (warning triangle; red circle when `danger`), the title is the question (« Delete the local copy? »), the body says what will happen with numbers (`consequences`), the buttons are « Cancel » and the verb (« Delete », « Convert again and index ») — `danger` variant only when something is lost. Focus starts on Cancel for a danger confirmation, on the verb otherwise.",
    },
    {
      head: "States",
      text: "open · busy (the primary shows its spinner, close is disabled, the foot note says « Do not close ») · error (a danger banner at the top of the body; the dialog stays open) · long (the body scrolls under a fixed head and foot).",
    },
    {
      head: "Rules",
      text: "Escape and the close button cancel, except while busy. One modal at a time (a confirmation over a modal replaces its foot instead). A modal never opens on page load. Never put a modal's only explanation in a tooltip.",
    },
  ],
  states: () => (
    <States>
      <Cell label="md · a form" wide column>
        <Modal
          title="Open a project by its Jira key"
          subtitle="Testimus opens the project folder that has this key, or creates one beside the last project."
          actions={formActions}
          onClose={none}
          debugState="open"
        >
          <Text label="Jira project key" hint="Upper case, as in Jira: LFRPS12, BHPTCC." value="LFRPS12" />
        </Modal>
      </Cell>
      <Cell label="sm · confirmation (danger): focus on Cancel" wide column>
        <Modal
          title="Delete the local copy?"
          size="sm"
          confirm={{ verb: "Delete", danger: true, onConfirm: none }}
          consequences={[
            [2, "modified steps are lost"],
            [1, "added step is lost"],
          ]}
          onClose={none}
          debugState="open"
        >
          LFRPS12-1420 has changes that are not in Jira yet.
        </Modal>
      </Cell>
      <Cell label="sm · confirmation: focus on the verb" wide column>
        <Modal
          title="Convert the document again?"
          size="sm"
          confirm={{ verb: "Convert again and index", onConfirm: none }}
          consequences={[[3, "figures are described again by Claude"]]}
          onClose={none}
          debugState="open"
        >
          The copy in Jira replaces the local one.
        </Modal>
      </Cell>
      <Cell label="busy · its own foot note" wide column>
        <Modal
          title="Pushing to Jira"
          subtitle="LFRPS12-1398 · 5 operations"
          busy
          footNote={
            <>
              <Icon name="info" size="sm" />
              Do not close Testimus while pushing
            </>
          }
          actions={
            <>
              <Button label="Cancel" disabled />
              <Button variant="primary" label="Push to Jira" loading />
            </>
          }
          onClose={none}
          debugState="open"
        >
          Step 3 of 5 — updating the expected results.
        </Modal>
      </Cell>
      <Cell label="error" wide column>
        <Modal
          title="Push plan"
          error="Jira did not answer — try again in a minute."
          footNote="Same as testimus xray push LFRPS12-1398"
          actions={
            <>
              <Button label="Cancel" />
              <Button variant="primary" label="Push to Jira" />
            </>
          }
          onClose={none}
          debugState="open"
        >
          2 steps to update, 1 to add.
        </Modal>
      </Cell>
      <Cell label="long (the body scrolls under the head and the foot)" wide column>
        <Modal
          title="Track ids"
          size="lg"
          actions={<Button variant="primary" label="Done" />}
          onClose={none}
          debugState="open"
        >
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i}>{`EXI_MOP_SPF_511_A_${1650 + i * 10} — covered by ${i % 3} tests`}</span>
          ))}
        </Modal>
      </Cell>
      <Cell label="lg · flush (the lightbox)" wide column>
        <Modal
          title="fig-40.png"
          subtitle="Step 1 · Expected Result · 320 × 160"
          icon="image"
          size="lg"
          flush
          footNote="Scroll to zoom at the cursor · drag to pan · Esc closes"
          actions={<Button size="sm" icon="fit" label="Fit" />}
          onClose={none}
          debugState="open"
        >
          <div {...stylex.props(styles.well)}>
            <Icon name="image" size="lg" label="The figure" />
          </div>
        </Modal>
      </Cell>
      <Cell label="frameless (the palette: its search field is its head)" wide column>
        <Modal title="Search everything" frameless onClose={none} debugState="open">
          <Text ariaLabel="Search everything" icon="search" value="push" appearance="bare" />
        </Modal>
      </Cell>
      <Cell label="drawer left" wide column>
        <Modal title="Documents" drawer="left" flush onClose={none} debugState="open">
          <Button variant="quiet" block label="Traction" />
          <Button variant="quiet" block label="Signalisation" />
        </Modal>
      </Cell>
      <Cell label="drawer right" wide column>
        <Modal title="About this document" drawer="right" onClose={none} debugState="open">
          Validated · indexed 30 Oct, 09:02
        </Modal>
      </Cell>
    </States>
  ),
};
