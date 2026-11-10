import * as stylex from "@stylexjs/stylex";
import type { DocRef, StepColumn } from "../../../core/types.ts";
import { changed } from "../../components/claude/pieces.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Menu } from "../../components/ui/Menu.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import type { DocWork } from "../../lib/scope.ts";
import type { Upload } from "../../lib/uploads.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { UploadFailure } from "../documents/UploadItem.tsx";
import { ColumnsView } from "./ColumnsView.tsx";
import { DocScopePicker } from "./DocScopePicker.tsx";
import { IndexNotice, type Work } from "./IndexNotice.tsx";
import { RequestBlock } from "./RequestBlock.tsx";
import type { GenerateForm } from "./useGenerateForm.ts";

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", backgroundColor: color.surface },
  scroll: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s7,
    paddingBlockStart: space.s6,
    paddingBlockEnd: space.s8,
    paddingInline: space.s6,
  },
  block: { display: "flex", flexDirection: "column", gap: space.s3 },
  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: size.controlSm },
  label: { margin: 0, color: color.text },
  foot: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    paddingBlock: space.s4,
    paddingInline: space.s6,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  recap: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1, color: color.textMuted },
  reason: { display: "inline-flex", alignItems: "center", gap: space.s1, color: color.text },
});

export type Gate = {
  /** documents in scope search cannot find (gen.preview): Generate refuses them */
  missing: string[];
  /** documents not indexed, so left out of the scope until they are */
  leftOut: string[];
  stale: string[];
  /** the document work under way that Generate waits for */
  work: Work | null;
  /** what that work is doing to the documents (which ones are being converted, whether an index runs) */
  docWork: DocWork;
  /** the running job's progress, when it says */
  progress?: { done: number; total: number };
  onShowJob?: () => void;
  onReindex: () => void;
  /** the last reindex that failed (the same banner as under the Documents list) */
  failure?: Upload;
};

export function RequestForm({
  form,
  docs,
  columns,
  folders,
  gate,
  hasJob,
  running,
  starting,
  blocked,
  unavailable,
  onGenerate,
  onColumns,
  onAddDocuments,
}: {
  form: GenerateForm;
  docs: DocRef[] | null;
  columns: StepColumn[];
  folders: string[];
  gate: Gate;
  hasJob: boolean;
  running: boolean;
  starting: boolean;
  blocked: string | null;
  unavailable?: string;
  onGenerate: () => void;
  onColumns: () => void;
  onAddDocuments: () => void;
}) {
  const scopes = form.scopes;
  const narrowed = Object.values(scopes).filter(Array.isArray).length;
  const inScope = form.scope.docs.length + new Set(form.scope.sections.map((s) => s.split("#")[0])).size;
  const folder = form.folder.trim();
  const p = useApp().info?.project;
  const jira = !!p?.jiraProject && !p.jiraOffline;
  return (
    <section aria-label="Request" {...stylex.props(styles.form)}>
      <div {...stylex.props(styles.scroll)}>
        {gate.failure && <UploadFailure u={gate.failure} inset={false} />}
        <IndexNotice {...gate} />
        <div {...stylex.props(styles.block)}>
          <div {...stylex.props(styles.head)}>
            <label htmlFor="gen-request" {...stylex.props(type.titleSm, styles.label)}>
              What should be tested?
            </label>
          </div>
          <RequestBlock form={form} readOnly={running} unavailable={unavailable} onGenerate={onGenerate} />
        </div>
        <div {...stylex.props(styles.block)}>
          <div {...stylex.props(styles.head)}>
            <h2 {...stylex.props(type.titleSm, styles.label)}>Documents</h2>
          </div>
          <DocScopePicker
            docs={docs}
            scopes={scopes}
            work={gate.docWork}
            onChange={form.setScopes}
            onAddDocuments={onAddDocuments}
          />
        </div>
        {docs && docs.length > 0 && <ColumnsView columns={columns} onEdit={onColumns} />}
        <Text
          label={jira ? "Xray folder" : "Folder"}
          placeholder="Empty: Claude suggests one per test"
          hint={jira ? "You can change it in each test before you push." : "You can change it in each test."}
          value={form.folder}
          onChange={form.setFolder}
          readOnly={running}
          trailing={
            folders.length > 0 && (
              <Menu
                label="Xray folders"
                align="end"
                entries={folders.map((f) => ({
                  label: f,
                  icon: "folder" as const,
                  checked: f === folder,
                  onSelect: () => form.setFolder(f),
                }))}
                trigger={<Button size="sm" variant="quiet" label="Choose…" disabled={running} />}
              />
            )
          }
        />
      </div>
      <div {...stylex.props(styles.foot)}>
        <div {...stylex.props(type.small, styles.recap)}>
          <span>
            {plural(inScope, "document")} in scope
            {narrowed ? ` · ${narrowed} narrowed to sections` : ""}
            {changed(form.pick) ? " · context changed for this run" : ""}
          </span>
          <span>
            {folder
              ? `Tests land on this PC as drafts in ${folder}.`
              : "Tests land on this PC as drafts; Claude suggests a folder per test."}
          </span>
          {blocked && !running && !starting && (
            <span {...stylex.props(styles.reason)}>
              <Icon name="info" size="sm" />
              {blocked}
            </span>
          )}
        </div>
        <Button
          variant={hasJob ? "secondary" : "primary"}
          icon="generate"
          label={running ? "Claude is writing…" : hasJob ? "Generate again" : "Generate"}
          shortcut={running || starting || blocked ? undefined : "Ctrl+Enter"}
          loading={running || starting}
          disabled={running || starting || (blocked ?? false)}
          onClick={onGenerate}
        />
      </div>
    </section>
  );
}
