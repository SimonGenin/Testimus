import { useCallback, useEffect, useState } from "react";
import { call } from "../../../api.ts";
import { Badge, Button, Icon, Skeleton } from "../../../components/ui/index.ts";
import { message } from "../../../lib/format.ts";
import type { OllamaState } from "./data.ts";
import { size } from "./data.ts";

const LOOK: Record<
  OllamaState["state"],
  { cls: string; icon: "check" | "info" | "warning" | "stop" | "lock"; word: string }
> = {
  absent: { cls: "s-info", icon: "info", word: "Not installed" },
  stopped: { cls: "s-warn", icon: "stop", word: "Installed, not running" },
  running: { cls: "s-ok", icon: "check", word: "Running" },
  disabled: { cls: "s-info", icon: "info", word: "Turned off" },
  refused: { cls: "s-err", icon: "lock", word: "Refused" },
};

export function OllamaPanel() {
  const [o, setO] = useState<OllamaState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    call<OllamaState>("models.ollama", {})
      .then((r) => {
        setO(r);
        setError("");
      })
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const look = o ? LOOK[o.state] : null;
  const embeds = o?.models.filter((m) => m.embedding) ?? [];
  return (
    <section className="ollama" aria-labelledby="s-ollama">
      <div className="sect-head">
        <h3 id="s-ollama" className="h ollama-title">
          Ollama
        </h3>
        <Badge tone="line" small>
          Optional
        </Badge>
        {look && (
          <span className={`sev ${look.cls}`}>
            <Icon name={look.icon} />
            {look.word}
            {o?.state === "running" && o.version ? ` ${o.version}` : ""}
          </span>
        )}
        <span className="spacer" />
        <Button size="sm" tone="quiet" icon="revert" disabled={loading} onClick={load}>
          Refresh
        </Button>
      </div>
      {error ? (
        <p className="sev s-err">
          <Icon name="error" />
          Ollama's state could not be read: {error}
        </p>
      ) : !o ? (
        <Skeleton w="70%" h={14} />
      ) : (
        <>
          <p>{o.message}</p>
          {o.state === "absent" && (
            <p className="muted">
              Every pack works without it. If you already use Ollama for other things, install it from{" "}
              <a href="https://ollama.com" target="_blank" rel="noreferrer">
                ollama.com
              </a>{" "}
              and Testimus will use the models it holds.
            </p>
          )}
          {o.state === "stopped" && !/start ollama/i.test(o.message) && (
            <p className="muted">Start Ollama, then Refresh.</p>
          )}
          {o.state === "running" && (
            <dl className="ollama-facts">
              <dt>Host</dt>
              <dd className="mono">{o.host}</dd>
              <dt>Embedding models</dt>
              <dd>
                {embeds.length
                  ? embeds.map((m) => (
                      <span key={m.name} className="ollama-model">
                        <span className="mono">{m.name}</span>
                        <span className="muted">
                          {" "}
                          {m.quantization} · {size(m.sizeMB)}
                          {m.catalog ? "" : " · not in the catalog"}
                        </span>
                      </span>
                    ))
                  : "None yet"}
              </dd>
              <dt>Loaded now</dt>
              <dd>
                {o.loaded.length
                  ? o.loaded.map((l) => (
                      <span key={l.name} className="ollama-model">
                        <span className="mono">{l.name}</span>
                        {` · ${size(l.sizeMB)} · `}
                        {l.vramMB < l.sizeMB ? (
                          <span className="sev s-warn ollama-offload">
                            <Icon name="warning" />
                            {l.vramMB > 0
                              ? `partly on the processor (${size(l.vramMB)} on the GPU)`
                              : "on the processor"}
                          </span>
                        ) : (
                          "on the GPU"
                        )}
                      </span>
                    ))
                  : "Nothing"}
              </dd>
            </dl>
          )}
          {o.state !== "absent" && (
            <dl className="ollama-facts">
              <dt>Its models folder</dt>
              <dd>
                <span className="mono">{o.storage.dir}</span>
                {o.storage.freeMB !== null && <span className="muted"> · {size(o.storage.freeMB)} free</span>}
                <span className="muted">
                  {" "}
                  · {o.storage.fromEnv ? "set by OLLAMA_MODELS" : "Ollama's default"}. Ollama owns it: to move it, stop
                  Ollama, move the folder, set the user variable OLLAMA_MODELS, start Ollama.
                </span>
              </dd>
            </dl>
          )}
        </>
      )}
    </section>
  );
}
