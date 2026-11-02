import { useEffect, useState } from "react";
import type { Settings } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Button, Segmented } from "../../components/ui/index.ts";
import { desktop, pickFiles } from "../../lib/desktop.ts";
import { readPref, readTheme, setThemeEverywhere, type Theme, writePref } from "../../lib/theme.ts";
import { errorToast } from "../../lib/toast.ts";

type Layout = "stacked" | "split";

const save = (patch: Record<string, unknown>) =>
  call<Settings>("system.saveSettings", patch).catch((e) => {
    errorToast(e, "Could not save the settings");
    return null;
  });

export function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [layout, setLayout] = useState<Layout>(() => readPref("testimus.stepLayout", ["stacked", "split"], "stacked"));
  const [s, setS] = useState<Settings | null>(null);
  const [exe, setExe] = useState("");
  useEffect(() => {
    call<Settings>("system.settings", {})
      .then((r) => {
        setS(r);
        setExe(r.claude?.exe ?? "");
      })
      .catch(() => {});
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("testimus:theme", onTheme);
    return () => window.removeEventListener("testimus:theme", onTheme);
  }, []);
  return (
    <section className="card sect" id="settings-appearance" aria-labelledby="s-look">
      <h2 id="s-look" className="h sect-title">
        Appearance and this PC
      </h2>
      <div className="formgrid">
        <div className="formfield">
          <span className="label">Theme</span>
          <Segmented
            label="Theme"
            value={theme}
            onChange={(t) => {
              setThemeEverywhere(t);
              setTheme(t);
              void save({ theme: t });
            }}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
        <div className="formfield">
          <span className="label">Step layout in the editor</span>
          <Segmented
            label="Step layout"
            value={layout}
            onChange={(l) => {
              setLayout(l);
              writePref("testimus.stepLayout", l);
              void save({ stepLayout: l });
            }}
            options={[
              { value: "stacked", label: "Stacked" },
              { value: "split", label: "Side by side" },
            ]}
          />
        </div>
      </div>
      <div className="formgrid">
        <div className="formfield">
          <label className="label" htmlFor="set-exe">
            Claude program
          </label>
          <div className="pickrow">
            <input
              id="set-exe"
              className="field mono"
              placeholder="Found on PATH"
              value={exe}
              onChange={(e) => setExe(e.target.value)}
              onBlur={() => s && exe !== s.claude.exe && void save({ claudeExe: exe }).then((r) => r && setS(r))}
            />
            {desktop() && (
              <Button
                aria-label="Browse for the Claude program"
                disabled={!s}
                onClick={() =>
                  void pickFiles("Choose the Claude program", [{ name: "Programs", extensions: ["exe", "cmd"] }], false)
                    .then(([picked]) => {
                      if (!picked) return null;
                      setExe(picked);
                      return save({ claudeExe: picked });
                    })
                    .then((r) => r && setS(r))
                }
              >
                Browse…
              </Button>
            )}
          </div>
        </div>
        <label className="formfield setcheck">
          <span className="label">Model downloads</span>
          <span>
            <input
              type="checkbox"
              checked={s?.models.allowRemote ?? true}
              disabled={!s}
              onChange={(e) => void save({ allowRemote: e.target.checked }).then((r) => r && setS(r))}
            />{" "}
            Allow downloads from Hugging Face (turn off behind a proxy that blocks it)
          </span>
        </label>
      </div>
    </section>
  );
}
