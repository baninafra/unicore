"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AIContext, type AIStatus, type ChatMessage, type GenerateOptions, type LocalAI } from "./use-local-ai";
import { useAISettings } from "./ai-settings";
import { chatStream, ensureServer, serverInfo, type ServerInfo } from "./server";
import { fetchCatalog, pickTier, suggestedSet, tierModels, type Catalog, type TaskHint } from "./models";
import { isDesktop } from "../desktop";
import { t } from "../i18n";

const AUTO_DL_KEY = "uc-ai-autodl";

const MSG_LOAD_FAILED = t("No pudimos preparar la IA. Revisá tu conexión y probá de nuevo.");
const MSG_GENERATE_FAILED = t("No pudimos generar la respuesta. Probá de nuevo.");

export function AIProvider({ children }: { children: ReactNode }) {
  const settings = useAISettings();

  // Qwen 3.5 (llama-server en esta PC).
  const [server, setServer] = useState<ServerInfo | null | undefined>(undefined);
  const [serverStatus, setServerStatus] = useState<AIStatus>("idle");
  const [serverError, setServerError] = useState<string>();
  const [serverProgress, setServerProgress] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const serverRef = useRef(server);
  serverRef.current = server;
  const busyRef = useRef(false);
  const lastUsedRef = useRef(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Cola simple: una generación por vez, para que no choquen las llamadas.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const refreshModels = useCallback(async () => {
    const [info, cat] = await Promise.all([serverInfo(), fetchCatalog()]);
    setServer(info);
    setCatalog(cat);
  }, []);

  // ¿Qué modelos Qwen 3.5 hay? ¿Ya corre alguno?
  useEffect(() => {
    let alive = true;
    Promise.all([serverInfo(), fetchCatalog()]).then(([info, cat]) => {
      if (!alive) return;
      setServer(info);
      setCatalog(cat);
      if (info?.running) setServerStatus("ready");
      // La primera vez se bajan solos los recomendados para esta PC (después, el usuario decide en Ajustes).
      if (cat && !localStorage.getItem(AUTO_DL_KEY)) {
        const missing = suggestedSet(cat).filter((m) => !m.installed);
        localStorage.setItem(AUTO_DL_KEY, "1");
        if (missing.length)
          import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("ia_download", { models: missing.map((m) => m.id) }))
            .catch(() => undefined);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Qué Qwen 3.5 usar: el del modo elegido, o en Automático el que pide la tarea.
  const resolveModel = useCallback((task?: TaskHint): string | undefined => {
    const tiers = tierModels(catalogRef.current);
    const mode = settingsRef.current.localModel;
    const current = serverRef.current?.model;
    // Mientras el agente trabaja no cambiamos de modelo (otro pedido en paralelo usa el que está).
    if (busyRef.current && current) return current;
    // Low sólo charla: si el pedido necesita herramientas o pensar, sube al menos a Default
    // (el modelo chico no entiende pedidos largos ni usa bien las herramientas).
    if (mode === "low") return (pickTier(task) === "low" ? tiers.low : tiers.default)?.id;
    if (mode === "default" || mode === "ultra") return tiers[mode]?.id;
    const want = tiers[pickTier(task)]?.id;
    const rank = (id?: string) => catalogRef.current?.models.find((m) => m.id === id)?.rank ?? 0;
    // En plena charla no bajamos de modelo: recargar tarda más de lo que se ahorra.
    if (current && rank(current) > rank(want) && Date.now() - lastUsedRef.current < 2 * 60_000) return current;
    return want;
  }, []);

  const load = useCallback(
    async (task?: TaskHint): Promise<void> => {
      if (settingsRef.current.localModel === "groq") {
        // Nube: no hay nada que cargar; sólo hace falta la clave.
        if (!settingsRef.current.groqKey.trim()) {
          const msg = t("Falta la clave de Groq. Pegala en Ajustes > IA.");
          setServerStatus("error");
          setServerError(msg);
          throw new Error(msg);
        }
        setServerError(undefined);
        setServerStatus((s) => (s === "generating" ? s : "ready"));
        return;
      }
      // Si recién se bajó un modelo, todavía no figura: releemos el catálogo.
      if (isDesktop() && !tierModels(catalogRef.current).ultra) {
        const cat = await fetchCatalog();
        catalogRef.current = cat;
        setCatalog(cat);
      }
      const model = resolveModel(task);
      if (isDesktop() && !model) {
        const msg = t("No hay ningún modelo Qwen 3.5 descargado. Bajá uno en Ajustes > IA.");
        setServerStatus("error");
        setServerError(msg);
        throw new Error(msg);
      }
      const switching = !!model && serverRef.current?.model !== model;
      setServerStatus((s) => (!switching && (s === "ready" || s === "generating") ? s : "loading"));
      setServerError(undefined);
      try {
        await ensureServer(model, (text) => setServerProgress(text));
        lastUsedRef.current = Date.now();
        setServerStatus((s) => (s === "generating" ? s : "ready"));
        setServerProgress("");
        const info = await serverInfo();
        if (info) {
          serverRef.current = info;
          setServer(info);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : MSG_LOAD_FAILED;
        setServerStatus("error");
        setServerError(msg);
        throw new Error(msg);
      }
    },
    [resolveModel],
  );

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const generate = useCallback(
    (messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> =>
      enqueue(async () => {
        const text = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
        await load({
          text: text.slice(0, 2000),
          chars: messages.reduce((n, m) => n + m.content.length, 0),
          json: opts.json,
        });

        setServerStatus("generating");
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
          const r = await chatStream(messages, {
            temperature: opts.temperature,
            maxTokens: opts.maxTokens ? Math.max(opts.maxTokens, 1024) : undefined,
            json: opts.json,
            think: settingsRef.current.think && !opts.json,
            signal: ctrl.signal,
            onDelta: (d) => opts.onToken?.(d.content),
          });
          return r.content;
        } catch (err) {
          console.warn("[IA] falló la generación", err);
          throw new Error(MSG_GENERATE_FAILED);
        } finally {
          abortRef.current = null;
          setServerStatus((s) => (s === "generating" ? "ready" : s));
        }
      }),
    [enqueue, load],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
    if (!busy) lastUsedRef.current = Date.now();
    setServerStatus(busy ? "generating" : "ready");
  }, []);

  const value = useMemo<LocalAI>(
    () => ({
      vision: !!server?.vision,
      status: serverStatus,
      progress: 0,
      progressText: serverProgress,
      error: serverError,
      load,
      generate,
      stop,
      setBusy,
      catalog,
      currentModel: server?.model,
      refreshModels,
    }),
    [server?.vision, server?.model, serverStatus, serverProgress, serverError, load, generate, stop, setBusy, catalog, refreshModels],
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}
