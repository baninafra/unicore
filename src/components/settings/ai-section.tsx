"use client";

// Ajustes > IA: descargar la IA básica o la potente y elegir cuál usar.

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Download, Trash2, Check } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { useAISettings, writeAISettings } from "@/lib/ai/ai-settings";
import { serverInfo, stopServer, type ServerInfo } from "@/lib/ai/server";
import { readCacheKind } from "@/lib/ai/ai-provider";

const BASIC_MODEL = "Qwen2.5-7B-Instruct-q4f16_1-MLC";
const GB = 1e9;

interface DownloadState {
  running: boolean;
  done: number;
  total: number;
  step: string;
  error?: string | null;
  finished: boolean;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const fmtGb = (b: number) => `${(b / GB).toLocaleString("es-AR", { maximumFractionDigits: 1 })} GB`;

function Card({
  title,
  size,
  text,
  status,
  active,
  children,
}: {
  title: string;
  size: string;
  text: string;
  status: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("card space-y-3 p-4", active && "border-primary")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="t-h3">{title}</p>
          <p className="t-small text-muted">{size}</p>
        </div>
        {active && <span className="badge badge-primary">En uso</span>}
      </div>
      <p className="t-small text-muted">{text}</p>
      <div className="t-small">{status}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function AISection() {
  const ai = useLocalAI();
  const settings = useAISettings();
  const desktop = isDesktop();

  const [server, setServer] = useState<ServerInfo | null>(null);
  const [dl, setDl] = useState<DownloadState | null>(null);
  const [free, setFree] = useState<number>();
  const [basicCached, setBasicCached] = useState<boolean>();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(async () => {
    setServer(await serverInfo());
    if (desktop) setDl(await invoke<DownloadState>("ia_download_status").catch(() => null));
  }, [desktop]);

  useEffect(() => {
    void refresh();
    if (desktop) invoke<number>("ia_free_space").then(setFree).catch(() => undefined);
    import("@mlc-ai/web-llm")
      .then((w) => w.hasModelInCache(BASIC_MODEL, { ...w.prebuiltAppConfig, cacheBackend: readCacheKind() ? "indexeddb" : "cache" }))
      .then(setBasicCached)
      .catch(() => setBasicCached(false));
  }, [desktop, refresh]);

  // Mientras se descarga, actualizamos el progreso cada segundo.
  useEffect(() => {
    if (!dl?.running) return;
    const t = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(t);
  }, [dl?.running, refresh]);

  // Cuando la IA básica termina de cargar, ya está descargada.
  useEffect(() => {
    if (ai.engine === "navegador" && ai.status === "ready") setBasicCached(true);
  }, [ai.engine, ai.status]);

  const powerInstalled = !!server?.installed;
  const usingPower = ai.engine === "servidor";
  const usingBasic = ai.engine === "navegador";

  async function downloadPower() {
    await invoke("ia_download");
    await refresh();
  }

  async function removePower() {
    setConfirmRemove(false);
    await stopServer();
    await invoke("ia_remove").catch(() => undefined);
    if (settings.localModel === "servidor") writeAISettings({ localModel: "auto" });
    await refresh();
  }

  function useBasic() {
    writeAISettings({ localModel: BASIC_MODEL });
    // Al elegirla se descarga (una sola vez) y se carga.
    window.setTimeout(() => ai.load().catch(() => undefined), 50);
  }

  async function removeBasic() {
    const w = await import("@mlc-ai/web-llm");
    await w.deleteModelAllInfoInCache(BASIC_MODEL, { ...w.prebuiltAppConfig, cacheBackend: readCacheKind() ? "indexeddb" : "cache" }).catch(() => undefined);
    setBasicCached(false);
    if (settings.localModel === BASIC_MODEL) writeAISettings({ localModel: "auto" });
  }

  const pct = dl && dl.total ? Math.min(100, Math.round((dl.done / dl.total) * 100)) : 0;

  let powerStatus: React.ReactNode;
  if (!desktop) powerStatus = <span className="text-muted">Disponible en la app de escritorio.</span>;
  else if (dl?.running)
    powerStatus = (
      <div className="space-y-1">
        <div className="progress h-1.5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="text-faint">
          {dl.step} {fmtGb(dl.done)} de {fmtGb(dl.total)} · {pct} %
        </p>
      </div>
    );
  else if (dl?.error) powerStatus = <span className="text-rose">{dl.error}</span>;
  else if (powerInstalled)
    powerStatus = (
      <span className="flex items-center gap-1 text-mint">
        <Check className="h-3.5 w-3.5" strokeWidth={2} /> Descargada{server?.running ? " · funcionando" : ""}
      </span>
    );
  else
    powerStatus = (
      <span className="text-muted">
        No descargada.{free !== undefined && ` Espacio libre: ${fmtGb(free)}.`}
        {free !== undefined && free < 16 * GB && <span className="text-rose"> No alcanza: hacen falta unos 16 GB.</span>}
      </span>
    );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="t-h2">IA</h2>
        <p className="t-small mt-1 text-muted">Las dos corren en tu PC: lo que escribís no sale de tu computadora (salvo cuando le pedís que busque en internet).</p>
      </div>

      <Card
        title="IA potente"
        size="Qwen3.5 35B · 14 GB · usa la placa de video y la RAM"
        text="Actúa en la app: crea y borra tareas, carga cronogramas, arma apuntes y flashcards, busca en internet y lee fotos y documentos. Recomendada."
        status={powerStatus}
        active={usingPower}
      >
        {desktop && !powerInstalled && !dl?.running && (
          <button type="button" className="btn btn-sm" onClick={() => void downloadPower()} disabled={free !== undefined && free < 15 * GB}>
            <Download className="h-4 w-4" strokeWidth={1.75} /> Descargar
          </button>
        )}
        {powerInstalled && !usingPower && (
          <button type="button" className="btn btn-sm" onClick={() => writeAISettings({ localModel: "servidor" })}>
            Usar esta
          </button>
        )}
        {powerInstalled &&
          (confirmRemove ? (
            <>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void removePower()}>
                Eliminar 14 GB
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} /> Eliminar
            </button>
          ))}
      </Card>

      <Card
        title="IA básica"
        size="Qwen 2.5 7B · 4,5 GB · corre dentro de la app"
        text="Más liviana y rápida de bajar. También actúa en la app (tareas, notas, ideas, cronogramas, cuestionarios, búsqueda web), pero con menos memoria: conviene para pedidos cortos. No ve imágenes."
        status={
          usingBasic && ai.status === "loading" ? (
            <div className="space-y-1">
              <div className="progress h-1.5">
                <i style={{ width: `${Math.round(ai.progress * 100)}%` }} />
              </div>
              <p className="text-faint">{ai.progressText}</p>
            </div>
          ) : basicCached ? (
            <span className="flex items-center gap-1 text-mint">
              <Check className="h-3.5 w-3.5" strokeWidth={2} /> Descargada
            </span>
          ) : (
            <span className="text-muted">No descargada.</span>
          )
        }
        active={usingBasic}
      >
        {!usingBasic && (
          <button type="button" className="btn btn-sm" onClick={useBasic}>
            {basicCached ? "Usar esta" : (
              <>
                <Download className="h-4 w-4" strokeWidth={1.75} /> Descargar y usar
              </>
            )}
          </button>
        )}
        {basicCached && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeBasic()}>
            <Trash2 className="h-4 w-4" strokeWidth={1.75} /> Eliminar
          </button>
        )}
      </Card>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-4 border-b border-border py-2">
          <span className="t-small">
            Razonar antes de responder
            <span className="block text-faint">Más preciso en pedidos complicados, pero tarda más. Sólo la IA potente.</span>
          </span>
          <input type="checkbox" checked={settings.think} onChange={(e) => writeAISettings({ think: e.target.checked })} />
        </label>
      </div>
    </div>
  );
}
