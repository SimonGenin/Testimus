import { type CSSProperties, useEffect, useState } from "react";
import type { FigureEntry } from "../../../core/types.ts";
import { call, fileUrl } from "../../api.ts";
import { Icon } from "../../components/legacy/index.ts";
import { cx } from "../../lib/format.ts";
import type { Upload } from "../../lib/uploads.ts";

type Outline = { toc: { anchor: string; title: string; level: number }[]; figures: FigureEntry[] };
type Step = "read" | "figures" | "index";

const STEPS: { key: Step; label: string }[] = [
  { key: "read", label: "Reading the file" },
  { key: "figures", label: "Claude describes the figures" },
  { key: "index", label: "Indexing" },
];
// ponytail: the core describes figures 20 at a time (FIGURES_BATCH); the next batch is the one Claude is looking at
const BATCH = 20;
const SECTIONS = 30;
const THUMBS = 18;

// ponytail: the panel remounts when the conversion lands; what was already shown does not fade in a second time
const seen = new Map<string, { sections: number; figures: number }>();

const stepOf = (u: Upload): Step =>
  u.phase === "indexing" ? "index" : /figure|re-checking/i.test(u.message) ? "figures" : "read";

export function DocReading({ docId, upload }: { docId: string; upload: Upload }) {
  const [outline, setOutline] = useState<Outline>({ toc: [], figures: [] });
  const step = stepOf(upload);
  const known = outline.toc.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again at each step the job reports, not while it only indexes
  useEffect(() => {
    if (step === "index" && known) return;
    let dead = false;
    call<Outline>("docs.show", { id: docId, brief: true })
      .then((r) => !dead && setOutline({ toc: r.toc ?? [], figures: r.figures ?? [] }))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [docId, upload.message, upload.phase]);

  const before = seen.get(docId) ?? { sections: 0, figures: 0 };
  const sections = outline.toc.filter((t) => t.level <= 2);
  const shownSections = sections.slice(0, SECTIONS);
  const figures = outline.figures.filter((f) => f.file);
  const thumbs = figures.slice(0, THUMBS);
  useEffect(() => {
    seen.set(docId, {
      sections: Math.max(before.sections, shownSections.length),
      figures: Math.max(before.figures, thumbs.length),
    });
  });

  const described = figures.filter((f) => f.description.trim()).length;
  const looking = new Set(
    step === "figures"
      ? figures
          .filter((f) => !f.description.trim())
          .slice(0, BATCH)
          .map((f) => f.anchor)
      : [],
  );
  const filled = step === "index" && upload.pct !== null ? Math.round((upload.pct / 100) * shownSections.length) : 0;
  const at = STEPS.findIndex((s) => s.key === step);

  return (
    <section className="card docread" aria-label="Reading the document" aria-busy="true">
      <ol className="docread-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className={cx("docread-step", i < at && "is-done", i === at && "is-now")}
            aria-current={i === at ? "step" : undefined}
          >
            <span className="docread-mark" aria-hidden="true">
              {i < at ? <Icon name="check" size={11} /> : i === at ? null : i + 1}
            </span>
            {s.label}
            {s.key === "figures" && figures.length > 0 && (
              <span className="docread-count">
                {described}/{figures.length}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="muted docread-msg" role="status">
        {upload.message}
      </p>

      {known ? (
        <ol className="docread-toc" aria-label="Sections read">
          {shownSections.map((t, i) => (
            <li
              key={t.anchor}
              className={cx(
                "docread-sec",
                i >= before.sections && "is-new",
                i < filled && "is-indexed",
                step === "index" && i === filled && "is-now",
              )}
              style={{ "--i": Math.max(0, i - before.sections), paddingLeft: (t.level - 1) * 14 } as CSSProperties}
            >
              <span className="docread-title">
                {/^§\d+(\.\d+)*$/.test(t.anchor) ? `${t.anchor.slice(1)} ` : ""}
                {t.title}
              </span>
              <span className="docread-fill" aria-hidden="true">
                <span className="docread-bar" />
              </span>
            </li>
          ))}
          {sections.length > SECTIONS && (
            <li className="docread-more muted">and {sections.length - SECTIONS} more sections</li>
          )}
        </ol>
      ) : (
        <div className="docread-scan" aria-hidden="true">
          {[92, 64, 78, 55, 86, 70].map((w) => (
            <span key={w} className="docread-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}

      {thumbs.length > 0 && (
        <ul className="docread-figs" aria-label="Figures">
          {thumbs.map((f, i) => {
            const done = !!f.description.trim();
            return (
              <li
                key={f.anchor}
                className={cx(
                  "docread-fig",
                  i >= before.figures && "is-new",
                  done && "is-done",
                  looking.has(f.anchor) && "is-looking",
                )}
                style={{ "--i": Math.max(0, i - before.figures) } as CSSProperties}
                title={f.caption || f.anchor}
              >
                <img src={fileUrl(`docs/${docId}/${f.file}`)} alt="" loading="lazy" />
                {done && (
                  <span className="docread-ok">
                    <Icon name="check" size={10} />
                  </span>
                )}
                <span className="sr">
                  {f.caption || f.anchor}: {done ? "described" : "not described yet"}
                </span>
              </li>
            );
          })}
          {figures.length > THUMBS && <li className="docread-fig docread-fig-more">+{figures.length - THUMBS}</li>}
        </ul>
      )}

      <p className="docread-lock muted">
        <Icon name="lock" size={13} />
        The text and the figures open once the document is converted and indexed.
      </p>
    </section>
  );
}
