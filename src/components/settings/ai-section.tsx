"use client";

// Ajustes > IA: bajar los tamaños de Qwen 3.5 que aguanta la PC y elegir el modo
// (Automático, Low, Default o Ultra). Groq es la opción en la nube.

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Download, Trash2, Check } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { useAISettings, writeAISettings } from "@/lib/ai/ai-settings";
import { readCacheKind } from "@/lib/ai/ai-provider";
import { t, intlLocale } from "@/lib/i18n";
import { fits, maxModel, suggestedSet, tierModels, type Tier } from "@/lib/ai/models";

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

const fmtGb = (b: number) => `${(b / GB).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} GB`;

const MODES: { id: "auto" | Tier; title: string; text: string }[] = [
  { id: "auto", title: t("Automático"), text: t("Elige solo según el pedido: el chico para charlar, el mediano para tareas y notas, el grande para resúmenes, ejercicios e imágenes.") },
  { id: "low", title: "Low", text: t("El modelo más chico que bajaste. Responde rapidísimo.") },
  { id: "default", title: "Default", text: t("El del medio. Buen equilibrio entre velocidad y calidad.") },
  { id: "ultra", title: "Ultra", text: t("El más grande que bajaste. Más lento, pero el que mejor razona.") },
];

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
        {active && <span className="badge badge-primary">{t("En uso")}</span>}
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

  const [dl, setDl] = useState<DownloadState | null>(null);
  const [free, setFree] = useState<number>();
  const [basicCached, setBasicCached] = useState<boolean>();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const { refreshModels } = ai;

  const refresh = useCallback(async () => {
    if (desktop) {
      setDl(await invoke<DownloadState>("ia_download_status").catch(() => null));
      await refreshModels();
    }
  }, [desktop, refreshModels]);

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
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [dl?.running, refresh]);

  // Cuando la IA básica termina de cargar, ya está descargada.
  useEffect(() => {
    if (ai.engine === "navegador" && ai.status === "ready") setBasicCached(true);
  }, [ai.engine, ai.status]);

  const usingGroq = settings.localModel === "groq";
  const usingBasic = ai.engine === "navegador";

  const catalog = ai.catalog;
  const hw = catalog?.hardware;
  const max = catalog ? maxModel(catalog) : undefined;
  const suggested = catalog ? suggestedSet(catalog) : [];
  const missing = suggested.filter((m) => !m.installed);
  const missingBytes = missing.reduce((n, m) => n + m.bytes, 0);
  const tiers = tierModels(catalog);
  const anyInstalled = !!tiers.ultra;

  async function download(models: string[]) {
    await invoke("ia_download", { models }).catch(() => undefined);
    await refresh();
  }

  async function removeModel(id: string) {
    setConfirmRemove(null);
    await invoke("ia_remove", { model: id }).catch(() => undefined);
    await refresh();
  }

  async function removeBasic() {
    const w = await import("@mlc-ai/web-llm");
    await w.deleteModelAllInfoInCache(BASIC_MODEL, { ...w.prebuiltAppConfig, cacheBackend: readCacheKind() ? "indexeddb" : "cache" }).catch(() => undefined);
    setBasicCached(false);
  }

  const pct = dl && dl.total ? Math.min(100, Math.round((dl.done / dl.total) * 100)) : 0;

  const progress = dl?.running ? (
    <div className="space-y-1">
      <div className="progress h-1.5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="t-small text-faint">
        {dl.step} {t("{done} de {total}", { done: fmtGb(dl.done), total: fmtGb(dl.total) })} · {pct} %
      </p>
    </div>
  ) : dl?.error ? (
    <p className="t-small text-rose">{dl.error}</p>
  ) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="t-h2">{t("IA")}</h2>
        <p className="t-small mt-1 text-muted">{t("Qwen 3.5 corre en tu PC: lo que escribís no sale de tu computadora (salvo cuando le pedís que busque en internet o usás Groq).")}</p>
      </div>

      {desktop && (
        <section className="space-y-4">
          <div>
            <h3 className="t-h3">{t("Qwen 3.5 en tu PC")}</h3>
            {hw && (
              <p className="t-small mt-1 text-muted">
                {hw.gpu && hw.vram >= 2 * GB ? `${hw.gpu} (${fmtGb(hw.vram)})` : t("Sin placa de video dedicada")} · {t("{ram} de RAM", { ram: fmtGb(hw.ram) })}
                {free !== undefined && ` · ${t("{free} libres", { free: fmtGb(free) })}`}
              </p>
            )}
            {max && (
              <p className="t-small mt-1">
                {t("Tu PC aguanta hasta {model}. Para tener los tres modos conviene bajar {sizes}.", { model: max.label, sizes: suggested.map((m) => m.label.replace("Qwen3.5 ", "")).join(" + ") })}
              </p>
            )}
          </div>

          {progress}

          {missing.length > 0 && !dl?.running && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void download(missing.map((m) => m.id))}
              disabled={free !== undefined && free < missingBytes + GB}
            >
              <Download className="h-4 w-4" strokeWidth={1.75} /> {t("Descargar los recomendados ({size})", { size: fmtGb(missingBytes) })}
            </button>
          )}

          <div className="card divide-y divide-border">
            {catalog?.models.map((m) => {
              const ok = hw ? fits(m, hw) : true;
              const tierOf = (Object.keys(tiers) as Tier[]).filter((tier) => tiers[tier]?.id === m.id);
              const running = ai.currentModel === m.id;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="t-small flex flex-wrap items-center gap-1.5 font-medium">
                      {m.label}
                      {m.moe && <span className="badge">{t("MoE · rápido")}</span>}
                      {max?.id === m.id && <span className="badge badge-primary">{t("Máximo para tu PC")}</span>}
                      {!ok && <span className="badge badge-amber">{t("Muy pesado para tu PC")}</span>}
                      {tierOf.map((tier) => (
                        <span key={tier} className="badge badge-cyan">
                          {MODES.find((x) => x.id === tier)?.title}
                        </span>
                      ))}
                    </p>
                    <p className="t-small text-faint">
                      {fmtGb(m.bytes)}
                      {m.installed && (
                        <span className="text-mint">
                          {" "}
                          · <Check className="inline h-3.5 w-3.5" strokeWidth={2} /> {t("Descargado")}{running ? ` · ${t("funcionando")}` : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  {!m.installed && !dl?.running && (
                    <button
                      type="button"
                      className={clsx("btn btn-sm", !ok && "btn-ghost")}
                      onClick={() => void download([m.id])}
                      disabled={free !== undefined && free < m.bytes + GB}
                    >
                      <Download className="h-4 w-4" strokeWidth={1.75} /> {t("Descargar")}
                    </button>
                  )}
                  {m.installed &&
                    (confirmRemove === m.id ? (
                      <>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => void removeModel(m.id)}>
                          {t("Eliminar {size}", { size: fmtGb(m.bytes) })}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(null)}>
                          {t("Cancelar")}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(m.id)}>
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} /> {t("Eliminar")}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <p className="t-small font-medium">{t("Modo")}</p>
            {!anyInstalled && <p className="t-small text-muted">{t("Bajá al menos un modelo para usar la IA en tu PC.")}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((mode) => {
                const active = settings.localModel === mode.id;
                const model = mode.id === "auto" ? undefined : tiers[mode.id];
                return (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={!anyInstalled}
                    onClick={() => writeAISettings({ localModel: mode.id })}
                    className={clsx("card space-y-1 p-3 text-left disabled:opacity-50", active && "border-primary")}
                    aria-pressed={active}
                  >
                    <p className="t-small flex items-center gap-1.5 font-medium">
                      {mode.title}
                      {model && <span className="text-faint">· {model.label}</span>}
                      {active && <span className="badge badge-primary ml-auto">{t("En uso")}</span>}
                    </p>
                    <p className="t-small text-muted">{mode.text}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <Card
        title={t("Qwen 3.8 en Groq")}
        size={t("qwen/qwen3.8-27b · en la nube · necesita internet y una clave de Groq")}
        text={t("Actúa igual que Qwen 3.5 en tu PC, pero el modelo corre en los servidores de Groq: lo que escribís sale de tu PC. Groq tiene capa gratuita.")}
        status={
          settings.groqKey.trim() ? (
            <span className="flex items-center gap-1 text-mint">
              <Check className="h-3.5 w-3.5" strokeWidth={2} /> {t("Clave guardada en este equipo")}
            </span>
          ) : (
            <span className="text-muted">{t("Pegá tu clave de Groq (console.groq.com).")}</span>
          )
        }
        active={usingGroq}
      >
        <input
          type="password"
          className="input w-full"
          placeholder="gsk_…"
          aria-label={t("Clave de Groq")}
          value={settings.groqKey}
          onChange={(e) => writeAISettings({ groqKey: e.target.value.trim() })}
        />
        {!usingGroq && (
          <button type="button" className="btn btn-sm" onClick={() => writeAISettings({ localModel: "groq" })}>
            {t("Usar esta")}
          </button>
        )}
      </Card>

      {!desktop && (
        <Card
          title={t("IA básica")}
          size={t("Qwen 2.5 7B · 4,5 GB · corre dentro de la app")}
          text={t("Más liviana y rápida de bajar. También actúa en la app (tareas, notas, ideas, cronogramas, cuestionarios, búsqueda web), pero con menos memoria: conviene para pedidos cortos. No ve imágenes.")}
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
                <Check className="h-3.5 w-3.5" strokeWidth={2} /> {t("Descargada")}
              </span>
            ) : (
              <span className="text-muted">{t("No descargada.")}</span>
            )
          }
          active={usingBasic}
        >
          {!usingBasic && (
            <button type="button" className="btn btn-sm" onClick={() => ai.load().catch(() => undefined)}>
              {basicCached ? (
                t("Usar esta")
              ) : (
                <>
                  <Download className="h-4 w-4" strokeWidth={1.75} /> {t("Descargar y usar")}
                </>
              )}
            </button>
          )}
          {basicCached && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeBasic()}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} /> {t("Eliminar")}
            </button>
          )}
        </Card>
      )}

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-4 border-b border-border py-2">
          <span className="t-small">
            {t("Razonar antes de responder")}
            <span className="block text-faint">{t("Más preciso en pedidos complicados, pero tarda más. En Automático usa el modelo más grande.")}</span>
          </span>
          <input type="checkbox" checked={settings.think} onChange={(e) => writeAISettings({ think: e.target.checked })} />
        </label>
      </div>
    </div>
  );
}
