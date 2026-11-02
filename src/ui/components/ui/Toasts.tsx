import { closeToast, useToasts } from "../../lib/toast.ts";
import { Icon } from "./Icon.tsx";

export function Toasts() {
  const list = useToasts();
  if (!list.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast" role={t.kind === "error" ? "alert" : "status"}>
          <Icon
            name={t.kind === "error" ? "error" : t.kind === "ok" ? "check" : "info"}
            className={`toast-icon toast-${t.kind}`}
          />
          <div className="toast-body">
            <span className="toast-title">{t.title}</span>
            {t.detail && <span className="toast-detail">{t.detail}</span>}
          </div>
          {t.action && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                t.action?.run();
                closeToast(t.id, true);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-sm iconbtn"
            aria-label="Dismiss"
            onClick={() => closeToast(t.id)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
