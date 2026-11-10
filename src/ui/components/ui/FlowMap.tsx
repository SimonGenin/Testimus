import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, container, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Checkbox } from "./Checkbox.tsx";
import { Disclosure } from "./Disclosure.tsx";
import { useFlowLinks } from "./flowLinks.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Raw } from "./Raw.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  frame: { containerType: "inline-size", minWidth: 0, minHeight: 0, height: "100%" },
  map: {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${space.s11} ${size.menuMin}`,
      [container.paneCompact]: "minmax(0, 1fr)",
    },
    gridTemplateRows: { default: "minmax(0, 1fr)", [container.paneCompact]: "auto minmax(0, 1fr)" },
    rowGap: space.s4,
    minHeight: 0,
    height: "100%",
  },
  list: { boxSizing: "border-box", minWidth: 0, minHeight: 0, overflowY: "auto", paddingInlineEnd: space.s3 },
  groups: { display: "flex", flexDirection: "column", gap: space.s5, minWidth: 0, paddingBlock: space.s2 },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  groupHead: { display: "flex", alignItems: "baseline", gap: space.s3 },
  groupCount: { color: color.textSubtle },
  nodes: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  node: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    paddingBlock: space.s3,
    borderTopStyle: "solid",
    borderTopWidth: { default: border.width, ":first-child": 0 },
    borderTopColor: color.border,
  },
  under: { paddingInlineStart: space.s7, borderTopWidth: 0, paddingTop: 0 },
  head: { display: "flex", alignItems: "flex-start", gap: space.s3, minWidth: 0 },
  pick: { flex: 1, minWidth: 0, display: "flex" },
  locked: { display: "inline-flex", alignItems: "flex-start", gap: space.s3, minWidth: 0, color: color.text },
  lock: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.iconMd,
    height: size.iconMd,
    marginTop: space.s1,
    color: color.textSubtle,
  },
  words: { display: "flex", flexDirection: "column", minWidth: 0 },
  name: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  lead: { display: "inline-flex", color: color.textMuted },
  why: { color: color.textSubtle },
  meta: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    paddingTop: space.s1,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
  metaOff: { color: color.textSubtle },
  more: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, paddingInlineStart: space.s6 },
  detail: { margin: 0, color: color.textSubtle, overflowWrap: "anywhere" },
  empty: { margin: 0, color: color.textSubtle },
  groupActions: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  links: {
    display: { default: "block", [container.paneCompact]: "none" },
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
  },
  link: { fill: "none", stroke: color.claudeBorder, strokeLinecap: "round", opacity: 0.8 },
  linkOff: { stroke: color.borderStrong, strokeDasharray: "4 5", opacity: 1 },
  target: {
    boxSizing: "border-box",
    alignSelf: "center",
    order: { default: 0, [container.paneCompact]: -1 },
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    padding: space.s5,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.claudeBorder,
    borderRadius: radius.r3,
    backgroundColor: color.claudeSubtle,
    color: color.text,
  },
  targetIcon: { display: "inline-flex", color: color.claudeText },
  title: { margin: 0, color: color.claudeText },
  total: { color: color.text },
  note: { color: color.textMuted },
});

export type FlowNode = {
  id: string;
  name: string;
  /** it goes to the target: its link is drawn full; off, dashed and muted */
  on: boolean;
  /** it cannot be unticked here: a lock in place of the checkbox, true (it always goes) or the reason in words */
  locked?: boolean | string;
  /** before its name, what the node is (a saved context: context) */
  icon?: IconName;
  /** how it reaches the target, as icon + word (« Said in full ») */
  how?: { icon: IconName; word: string };
  /** how big it is, in words (« ~1.2k tokens »), after the how */
  size?: string;
  /** its weight among the others: the width of its link grows with it */
  weight?: number;
  /** why it is there, under its name */
  why?: string;
  /** one line more (a context's files, a document's version) */
  detail?: string;
  /** its text, folded behind « What it says » */
  text?: string;
  /** it hangs under the node before it (a document's note under its document) */
  under?: boolean;
  /** at the end of its row: what else can be done with it (Edit…) */
  actions?: ReactNode;
};

export type FlowGroup = {
  label: string;
  nodes: FlowNode[];
  /** said when the group has no node */
  empty?: string;
  /** under the nodes: what can be added to the group (New context…) */
  actions?: ReactNode;
};

export type FlowMapProps = {
  /** the accessible name of the whole (« What this request is given ») */
  label: string;
  groups: FlowGroup[];
  /** where every node flows: its title, its total (« 9 of 12 pieces · ~8.4k tokens »), a line under it */
  target: { title: string; total?: string; note?: string; icon?: IconName };
  /** a node was ticked or unticked; left out, nothing can be ticked */
  onToggle?: (id: string, on: boolean) => void;
  /** nothing can be ticked for now (true, or the reason) */
  disabled?: boolean | string;
};

const THIN = 1.5;
const WIDE = 8;

// ponytail: what flows into one thing (design: none yet, asked on 2026-11-10) — a real list of checkboxes, grouped,
// on the left; the links to the target are decoration drawn over it (aria-hidden), each as wide as its node weighs and
// dashed when the node is off. The list scrolls inside the map when its container gives it a height: a link whose node
// is scrolled out of sight leaves from the corner it went past. Under 600 px of container the links go and the target
// sits above the list
export function FlowMap({ label, groups, target, onToggle, disabled = false }: FlowMapProps) {
  const { list, inner, frame, target: goal, links: drawn, measure } = useFlowLinks();
  const nodes = groups.flatMap((g) => g.nodes);
  const heaviest = Math.max(1, ...nodes.map((n) => n.weight ?? 0));
  const off = disabled !== false || !onToggle;

  // ponytail: sizes run from a few words to a whole document — the width follows the logarithm, so a note and a
  // document still differ at a glance without the document's link hiding every other
  const width = (n: FlowNode) =>
    n.on ? Math.round((THIN + ((WIDE - THIN) * Math.log1p(n.weight ?? 0)) / Math.log1p(heaviest)) * 10) / 10 : THIN;

  return (
    <div {...stylex.props(styles.frame)}>
      {/* biome-ignore lint/a11y/useSemanticElements: the whole map (list, links and target), not a form's fieldset — its groups of nodes are */}
      <div role="group" aria-label={label} {...stylex.props(styles.map)}>
        <div ref={list} onScroll={measure} {...stylex.props(styles.list)}>
          <div ref={inner} {...stylex.props(styles.groups)}>
            {groups.map((g) => (
              <fieldset key={g.label} aria-label={g.label} {...stylex.props(styles.group)}>
                <div {...stylex.props(type.caption, styles.groupHead)}>
                  <span aria-hidden="true">{g.label}</span>
                  {g.nodes.length > 0 && (
                    <span {...stylex.props(type.regular, type.tabular, styles.groupCount)}>
                      {g.nodes.filter((n) => n.on).length} of {g.nodes.length}
                    </span>
                  )}
                </div>
                {g.nodes.length > 0 ? (
                  <ul {...stylex.props(styles.nodes)}>
                    {g.nodes.map((n) => {
                      const why = typeof n.locked === "string" ? n.locked : "Always goes with it";
                      return (
                        <li key={n.id} {...stylex.props(styles.node, n.under && styles.under)}>
                          <div data-flow-node={n.id} {...stylex.props(styles.head)}>
                            <span {...stylex.props(styles.pick)}>
                              {n.locked ? (
                                <span {...stylex.props(type.compact, styles.locked)}>
                                  <span title={why} {...stylex.props(styles.lock)}>
                                    <Icon name="lock" size="sm" label={why} />
                                  </span>
                                  <span {...stylex.props(styles.words)}>
                                    <span {...stylex.props(styles.name)}>
                                      {n.icon && (
                                        <span {...stylex.props(styles.lead)}>
                                          <Icon name={n.icon} />
                                        </span>
                                      )}
                                      {n.name}
                                    </span>
                                    {n.why && <span {...stylex.props(type.small, styles.why)}>{n.why}</span>}
                                  </span>
                                </span>
                              ) : (
                                <Checkbox
                                  checked={n.on}
                                  onChange={(on) => onToggle?.(n.id, on)}
                                  label={n.name}
                                  hint={n.why}
                                  icon={n.icon}
                                  disabled={typeof disabled === "string" ? disabled : off}
                                />
                              )}
                            </span>
                            {(n.how || n.size) && (
                              <span {...stylex.props(type.small, type.tabular, styles.meta, !n.on && styles.metaOff)}>
                                {n.how && <Icon name={n.how.icon} size="sm" />}
                                {[n.how?.word, n.size].filter(Boolean).join(" · ")}
                              </span>
                            )}
                            {n.actions}
                          </div>
                          {(n.detail || n.text) && (
                            <div {...stylex.props(styles.more)}>
                              {n.detail && <p {...stylex.props(type.small, styles.detail)}>{n.detail}</p>}
                              {n.text && (
                                <Disclosure summary={`What « ${n.name} » says`} quiet>
                                  <Raw text={n.text} maxLines={12} label={`${n.name}, in full`} />
                                </Disclosure>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  g.empty && <p {...stylex.props(type.small, styles.empty)}>{g.empty}</p>
                )}
                {g.actions && <div {...stylex.props(styles.groupActions)}>{g.actions}</div>}
              </fieldset>
            ))}
          </div>
        </div>
        <svg ref={frame} aria-hidden="true" focusable="false" {...stylex.props(styles.links)}>
          {[...nodes.filter((n) => !n.on), ...nodes.filter((n) => n.on)].map((n) => {
            const y = drawn.at[n.id] ?? 0;
            const mid = drawn.w / 2;
            return (
              <path
                key={n.id}
                data-link={n.id}
                data-state={n.on ? "on" : "off"}
                d={`M0 ${y} C${mid} ${y} ${mid} ${drawn.to} ${drawn.w} ${drawn.to}`}
                strokeWidth={width(n)}
                {...stylex.props(styles.link, !n.on && styles.linkOff)}
              />
            );
          })}
        </svg>
        <div ref={goal} {...stylex.props(styles.target)}>
          <span {...stylex.props(styles.targetIcon)}>
            <Icon name={target.icon ?? "claude"} size="lg" />
          </span>
          <h3 {...stylex.props(type.titleSm, styles.title)}>{target.title}</h3>
          {target.total && (
            <span role="status" {...stylex.props(type.small, type.tabular, styles.total)}>
              {target.total}
            </span>
          )}
          {target.note && <span {...stylex.props(type.small, styles.note)}>{target.note}</span>}
        </div>
      </div>
    </div>
  );
}
