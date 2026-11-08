"use strict";
const STATUS = { passed: "Passed", problem: "Problem", blocked: "Blocked", "not-run": "Not run" };
const ICON = { passed: "✓", problem: "✕", blocked: "!", "not-run": "○" };
const embedded = JSON.parse(document.getElementById("run-data").textContent);
let run = embedded.run;
let results = embedded.results || {};
let mode = "browser";
let current = 0;
let shotsInPage = 0;
let notKept = false;
const auto = {};
const storeKey = () => `testimus-run:${run.slug}:${run.exportedAt}`;
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
};
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
const tester = () => document.getElementById("tester").value.trim() || "tester";
const resultOf = (t) => {
  const r = results[t.id] || {};
  const steps = t.steps.map((_, i) => {
    const m = (r.steps || [])[i];
    return m && typeof m.ok === "boolean" ? { ok: m.ok, ...(m.note ? { note: m.note } : {}) } : { ok: null, ...(m && m.note ? { note: m.note } : {}) };
  });
  const out = { status: STATUS[r.status] ? r.status : "not-run", steps, comments: r.comments || [], attachments: r.attachments || [] };
  if (r.blockedReason) out.blockedReason = r.blockedReason;
  if (r.updatedAt) out.updatedAt = r.updatedAt;
  if (r.updatedBy) out.updatedBy = r.updatedBy;
  if (r.history) out.history = r.history;
  return out;
};
// ponytail: a copy of the core's proposedStatus (src/core/lib/runs.ts), tested equal to it — only while the test is
// not run: any NOK proposes Problem, every step OK Passed, else nothing yet
function proposedStatus(r) {
  if (r.status !== "not-run") return null;
  if (r.steps.some((s) => s.ok === false)) return "problem";
  if (r.steps.length && r.steps.every((s) => s.ok === true)) return "passed";
  return null;
}

// ponytail: a field's text as the app writes it — lines, **bold**, and its pictures: the run's copy under
// images/<testId>/<the file's own name> (src/shared/run-image.ts)
function field(text, testId) {
  const box = el("div", { class: "cell" });
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    box.append(...bold(text.slice(at, m.index)));
    const file = m[1].split(/[\\/]/).pop();
    if (!/^[a-z]+:/i.test(m[1]) && /^[\w.-]+$/.test(file)) box.append(el("img", { src: `images/${encodeURIComponent(testId)}/${encodeURIComponent(file)}`, alt: file }));
    at = m.index + m[0].length;
  }
  box.append(...bold(text.slice(at)));
  return box;
}
function bold(s) {
  return s.split(/(\*\*[^*]+\*\*)/).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? el("strong", {}, p.slice(2, -2)) : document.createTextNode(p)));
}

function badge(status) {
  return el("span", { class: `badge ${status}` }, `${ICON[status]} ${STATUS[status]}`);
}

// ponytail: without a server the results are kept in this browser and the screenshots only in this page (too big for
// it): they reach a file with Save run.json
function keep() {
  try {
    const light = JSON.stringify(results, (k, v) => (k === "attachments" && Array.isArray(v) ? v.filter((a) => !a.data) : v));
    localStorage.setItem(storeKey(), light);
    return true;
  } catch {
    return false;
  }
}

function stamp(kept = true) {
  const s = document.getElementById("saved");
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const shots = shotsInPage === 1 ? "1 screenshot" : `${shotsInPage} screenshots`;
  s.textContent =
    mode === "server"
      ? `Saved in this folder · ${t}`
      : !kept
        ? "Not kept — press « Save run.json » now"
        : shotsInPage
          ? `Kept in this browser · ${t} — ${shots} only in this page: press « Save run.json » before closing it`
          : `Kept in this browser · ${t} — press « Save run.json » when you are done`;
}

async function save(t, r) {
  r.updatedAt = new Date().toISOString();
  r.updatedBy = tester();
  results[t.id] = r;
  if (mode === "server") {
    const res = await fetch(`results/${encodeURIComponent(t.id)}.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
    if (!res.ok) {
      document.getElementById("saved").textContent = `Not saved: ${(await res.json().catch(() => ({}))).error || res.status}`;
      return;
    }
    stamp();
  } else {
    notKept = !keep();
    stamp(!notKept);
  }
  renderList();
}

async function attach(t, r, step, file) {
  const ext = (file.name.match(/\.(png|jpe?g|gif|webp|bmp)$/i) || [".png"])[0].toLowerCase().replace("jpeg", "jpg");
  const name = `capture-${hex()}${ext}`;
  const a = { file: name, ...(step ? { step } : {}) };
  if (mode === "server") {
    const res = await fetch(`results/${encodeURIComponent(t.id)}/${name}`, { method: "PUT", body: file });
    if (!res.ok) return;
  } else {
    a.data = await new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.readAsDataURL(file);
    });
  }
  r.attachments.push(a);
  if (a.data) shotsInPage++;
  await save(t, r);
  renderTest();
}

function renderList() {
  const ol = document.getElementById("tests");
  ol.replaceChildren(
    ...run.tests.map((t, i) => {
      const r = resultOf(t);
      return el(
        "li",
        {},
        el(
          "button",
          { type: "button", "aria-current": i === current ? "true" : "false", on: { click: () => go(i) } },
          el("span", {}, `${i + 1}. ${t.summary}`),
          el("span", { class: "row small muted" }, badge(r.status), t.key ? el("span", { class: "mono" }, t.key) : null),
        ),
      );
    }),
  );
}

function go(i) {
  current = Math.max(0, Math.min(run.tests.length - 1, i));
  renderList();
  renderTest();
}

function renderTest() {
  const t = run.tests[current];
  const r = resultOf(t);
  const columns = [...new Set(t.steps.flatMap((s) => Object.keys(s.fields)))];
  const main = document.getElementById("test");
  const setStatus = (s) => {
    auto[t.id] = false;
    r.status = s;
    if (s !== "blocked") delete r.blockedReason;
    save(t, r).then(renderTest);
  };
  const mark = (i, ok) => {
    r.steps[i] = { ok: r.steps[i].ok === ok ? null : ok, ...(r.steps[i].note ? { note: r.steps[i].note } : {}) };
    if (auto[t.id] !== false && (r.status === "not-run" || auto[t.id])) {
      r.status = proposedStatus({ status: "not-run", steps: r.steps }) || "not-run";
      auto[t.id] = true;
    }
    save(t, r).then(renderTest);
  };
  const rows = t.steps.map((s, i) =>
    el(
      "tr",
      { class: r.steps[i].ok === false ? "nok" : "" },
      el("td", {}, String(i + 1)),
      ...columns.map((c) => el("td", {}, field(s.fields[c] || "", t.id))),
      el(
        "td",
        {},
        el(
          "div",
          { class: "marks", role: "group", "aria-label": `Step ${i + 1}` },
          el("button", { type: "button", class: "btn ok", "aria-pressed": String(r.steps[i].ok === true), on: { click: () => mark(i, true) } }, "OK"),
          el("button", { type: "button", class: "btn nok", "aria-pressed": String(r.steps[i].ok === false), on: { click: () => mark(i, false) } }, "NOK"),
        ),
      ),
      el(
        "td",
        {},
        el("textarea", {
          "aria-label": `Comment on step ${i + 1}`,
          on: {
            change: (e) => {
              const note = e.target.value.trim();
              r.steps[i] = { ok: r.steps[i].ok, ...(note ? { note } : {}) };
              save(t, r);
            },
          },
        }, r.steps[i].note || ""),
        el(
          "label",
          { class: "small muted" },
          "Screenshot ",
          el("input", { type: "file", accept: "image/*", "aria-label": `Screenshot of step ${i + 1}`, on: { change: (e) => e.target.files[0] && attach(t, r, i + 1, e.target.files[0]) } }),
        ),
        ...r.attachments.filter((a) => a.step === i + 1).map((a) => el("div", { class: "small mono" }, a.file)),
      ),
    ),
  );
  const comment = el("textarea", { "aria-label": "Add a comment or a question", placeholder: "Add a comment or a question…" });
  const addComment = (kind) => {
    const text = comment.value.trim();
    if (!text) return;
    r.comments.push({ id: hex(), kind, text, by: tester(), at: new Date().toISOString() });
    save(t, r).then(renderTest);
  };
  main.replaceChildren(...[
    el("div", {}, el("h2", {}, t.summary), el("div", { class: "small muted" }, [t.key || "Local test", `${t.steps.length} step(s)`, t.preconditions.length ? `Precondition: ${t.preconditions.join(", ")}` : ""].filter(Boolean).join(" · "))),
    t.description ? el("p", { class: "muted", style: "margin: 0" }, t.description) : null,
    el(
      "table",
      { "aria-label": "Steps" },
      el("thead", {}, el("tr", {}, el("th", {}, "#"), ...columns.map((c) => el("th", {}, c)), el("th", {}, "OK / NOK"), el("th", {}, "Comment"))),
      el("tbody", {}, ...rows),
    ),
    el(
      "div",
      { class: "row", role: "radiogroup", "aria-label": "Result of the test" },
      el("h2", { class: "grow" }, "Result of the test"),
      ...Object.keys(STATUS).map((s) =>
        el("button", { type: "button", role: "radio", class: "btn status", "aria-checked": String(r.status === s), "aria-pressed": String(r.status === s), on: { click: () => setStatus(s) } }, `${ICON[s]} ${STATUS[s]}`),
      ),
    ),
    r.status === "blocked"
      ? el("label", {}, "Why is it blocked? ", el("input", { type: "text", "aria-label": "Why is it blocked?", value: r.blockedReason || "", on: { change: (e) => { r.blockedReason = e.target.value.trim(); save(t, r); } } }))
      : null,
    el("h2", {}, "Comments and questions"),
    ...r.comments.map((c) =>
      el("div", { class: "card" }, el("span", { class: "small muted" }, [c.kind === "question" ? "Question" : "Comment", c.step ? `step ${c.step}` : "", c.by].filter(Boolean).join(" · ")), el("span", {}, c.text), c.answer ? el("span", { class: "muted" }, `— ${c.answer}`) : null),
    ),
    comment,
    el("div", { class: "row" }, el("button", { type: "button", class: "btn", on: { click: () => addComment("comment") } }, "Add a comment"), el("button", { type: "button", class: "btn", on: { click: () => addComment("question") } }, "Ask a question"), el("span", { class: "grow" }), el("button", { type: "button", class: "btn", on: { click: () => go(current - 1) } }, "Previous"), el("button", { type: "button", class: "btn primary", on: { click: () => go(current + 1) } }, "Next test")),
  ].filter(Boolean));
}

function download() {
  const blob = new Blob([`${JSON.stringify({ ...run, results }, null, 2)}\n`], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "run.json" });
  document.body.append(a);
  a.click();
  a.remove();
  shotsInPage = 0;
  notKept = false;
  if (mode === "browser") {
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    document.getElementById("saved").textContent = `run.json saved · ${t} — put it in this folder`;
  }
}

async function start() {
  if (location.protocol.startsWith("http")) {
    try {
      const res = await fetch("api/state", { cache: "no-store" });
      if (res.ok) {
        const s = await res.json();
        run = s.run;
        results = { ...(s.run.results || {}), ...s.results };
        mode = "server";
      }
    } catch {}
  }
  if (mode === "browser") {
    try {
      const kept = JSON.parse(localStorage.getItem(storeKey()) || "null");
      if (kept) results = { ...results, ...kept };
    } catch {}
    document.getElementById("notice").replaceChildren(
      el("div", { class: "banner", role: "note" }, "No local server: the results stay in this browser, the screenshots only in this page. When you are done, press « Save run.json » and put the file in this folder."),
    );
    window.addEventListener("beforeunload", (e) => {
      if (shotsInPage || notKept) e.preventDefault();
    });
  }
  document.title = `${run.name} — test run`;
  document.getElementById("title").textContent = run.name;
  document.getElementById("version").textContent = [run.version && `Version ${run.version}`, run.environment].filter(Boolean).join(" · ");
  try {
    document.getElementById("tester").value = localStorage.getItem("testimus-run:tester") || "";
  } catch {}
  document.getElementById("tester").addEventListener("change", (e) => {
    try {
      localStorage.setItem("testimus-run:tester", e.target.value.trim());
    } catch {}
  });
  document.getElementById("download").addEventListener("click", download);
  document.getElementById("saved").textContent = mode === "server" ? "Each change is saved in this folder" : "";
  go(0);
}
start();
