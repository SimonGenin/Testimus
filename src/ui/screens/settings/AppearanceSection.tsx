import { useEffect, useState } from "react";
import type { Settings } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Segmented } from "../../components/ui/index.ts";
import { desktop, readAlwaysOnTop, setAlwaysOnTop } from "../../lib/desktop.ts";
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
  const [onTop, setOnTop] = useState(readAlwaysOnTop);
  useEffect(() => {
    call<Settings>("system.settings", {})
      .then(setS)
      .catch(() => {});
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    const onPin = (e: Event) => setOnTop((e as CustomEvent<boolean>).detail === true);
    window.addEventListener("testimus:theme", onTheme);
    window.addEventListener("testimus:on-top", onPin);
    return () => {
      window.removeEventListener("testimus:theme", onTheme);
      window.removeEventListener("testimus:on-top", onPin);
    };
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
        {desktop() && (
          <div className="formfield">
            <span className="label" id="set-ontop-label">
              Window
            </span>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={onTop}
              aria-labelledby="set-ontop-label set-ontop-text"
              onClick={() => void setAlwaysOnTop(!onTop)}
            >
              <span className="switch-track">
                <span className="switch-knob" />
              </span>
              <span className="switch-text" id="set-ontop-text">
                <span>Always on top</span>
                <span className="muted">Keeps the window above Jira and the simulator.</span>
              </span>
            </button>
          </div>
        )}
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
