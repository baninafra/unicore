"use client";

// Actualizaciones con un clic (sólo en la app de escritorio): al abrir y cada 6 horas busca una versión
// nueva publicada en GitHub. Si hay, muestra un aviso abajo; "Instalar y reiniciar" la baja, la instala
// (el instalador viene firmado) y vuelve a abrir UniCore.

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { t } from "@/lib/i18n";

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

const EVENT = "uc:check-update";
// "Buscar actualizaciones" desde Ajustes. Responde con el resultado.
export function checkForUpdates(): Promise<"nueva" | "al-dia" | "error"> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent(EVENT, { detail: resolve })));
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<NonNullable<Update> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isDesktop()) return;
    const run = async (): Promise<"nueva" | "al-dia" | "error"> => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (found) {
          setUpdate(found);
          setHidden(false);
          return "nueva";
        }
        return "al-dia";
      } catch (e) {
        console.error("[UniCore] no se pudo buscar actualizaciones", e);
        return "error";
      }
    };
    const first = window.setTimeout(() => void run(), 8000);
    const every = window.setInterval(() => void run(), 6 * 60 * 60 * 1000);
    const manual = (e: Event) => void run().then((r) => (e as CustomEvent<(r: string) => void>).detail(r));
    window.addEventListener(EVENT, manual);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener(EVENT, manual);
    };
  }, []);

  async function install() {
    if (!update) return;
    setError(undefined);
    setProgress(0);
    try {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          if (total) setProgress(Math.min(99, Math.round((done / total) * 100)));
        } else if (ev.event === "Finished") setProgress(100);
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      console.error(e);
      setError(t("No se pudo instalar la actualización. Probá de nuevo más tarde."));
      setProgress(null);
    }
  }

  if (!update || hidden) return null;
  return (
    <div className="fixed bottom-10 left-1/2 z-[60] flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-lg border border-border-strong bg-surface p-3 shadow-pop">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-primary-tint text-primary-soft">
        <Download className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-small font-medium text-text">{t("Hay una versión nueva de UniCore ({version})", { version: update.version })}</span>
        <span className="t-small text-faint">
          {error ?? (progress === null ? t("Se instala en segundos y no se pierde nada.") : t("Descargando… {n}%", { n: progress }))}
        </span>
      </div>
      {progress === null ? (
        <>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()}>
            {t("Instalar y reiniciar")}
          </button>
          <button type="button" className="icon-btn" aria-label={t("Después")} title={t("Después")} onClick={() => setHidden(true)}>
            <X strokeWidth={1.75} />
          </button>
        </>
      ) : (
        <span className="progress w-24 flex-none" style={{ height: 4 }}>
          <i style={{ width: `${progress}%` }} />
        </span>
      )}
    </div>
  );
}
