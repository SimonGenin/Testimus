import { Button } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { AccessStep } from "./AccessStep.tsx";
import { PackStep } from "./PackStep.tsx";
import { ProjectStep } from "./ProjectStep.tsx";

const ARGS = [undefined, "project", "pack"];

export function FirstRunScreen() {
  const app = useApp();
  const step = app.route.arg === "pack" ? 2 : app.route.arg === "project" ? 1 : 0;
  const go = (s: number) => app.navigate("setup", ARGS[s]);
  return (
    <div className="screen setup">
      <div className="setup-col">
        <div className="setup-top">
          <span className="h setup-brand">
            <img className="brand-logo" src="/logo.png" alt="" />
            Testimus
          </span>
          <span className="spacer" />
          {app.info && (
            <Button tone="quiet" size="sm" icon="left" onClick={() => app.navigate("tests")}>
              Back to the app
            </Button>
          )}
        </div>
        <ol className="steps" aria-label="Setup steps">
          {["Access", "Project", "Search pack"].map((n, i) => (
            <li
              key={n}
              className={cx("step-pill", i <= step && "is-on", i < step && "is-done")}
              aria-current={i === step ? "step" : undefined}
            >
              <button type="button" className="step-pill-btn" onClick={() => go(i)}>
                <span className="step-n">{i + 1}</span>
                {n}
              </button>
            </li>
          ))}
        </ol>
        {step === 0 ? (
          <AccessStep onContinue={() => go(1)} onSkip={() => go(1)} />
        ) : step === 1 ? (
          <ProjectStep onBack={() => go(0)} onOpened={() => go(2)} />
        ) : (
          <PackStep onBack={() => go(1)} />
        )}
      </div>
    </div>
  );
}
