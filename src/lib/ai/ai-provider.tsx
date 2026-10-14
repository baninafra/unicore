"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ChatCompletionRequestStreaming,
  InitProgressReport,
  WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import {
  AIContext,
  type AIStatus,
  type ChatMessage,
  type GenerateOptions,
  type LocalAI,
  type AIEngine,
} from "./use-local-ai";
import { useAISettings } from "./ai-settings";
import { chatStream, ensureServer, serverInfo, type ServerInfo } from "./server";

// Modelos locales (WebLLM). En automático se elige según la placa de video.
const MODEL_7B = "Qwen2.5-7B-Instruct-q4f16_1-MLC";
const MODEL_3B_F16 = "Qwen2.5-3B-Instruct-q4f16_1-MLC";
const MODEL_3B_F32 = "Qwen2.5-3B-Instruct-q4f32_1-MLC";
// Cuanto más alto, más pesado.
const MODEL_RANK: Record<string, number> = { [MODEL_3B_F32]: 1, [MODEL_3B_F16]: 2, [MODEL_7B]: 3 };

const MODEL_STORAGE_KEY = "uc-ai-model";
const GIB = 1024 ** 3;

const MSG_UNSUPPORTED = "Tu navegador no puede correr la IA. Probá con Chrome o Edge actualizados.";
const MSG_LOAD_FAILED = "No pudimos preparar la IA. Revisá tu conexión y probá de nuevo.";
const MSG_GENERATE_FAILED = "No pudimos generar la respuesta. Probá de nuevo.";

// WebGPU no está en los tipos de TypeScript 5.9, así que declaramos sólo lo que usamos.
interface GPUAdapterLike {
  features: { has(feature: string): boolean };
  limits: { maxBufferSize: number };
}
type NavigatorWithGPU = Navigator & {
  gpu?: { requestAdapter(): Promise<GPUAdapterLike | null> };
  deviceMemory?: number;
};

async function requestAdapter(): Promise<GPUAdapterLike | null> {
  const gpu = (navigator as NavigatorWithGPU).gpu;
  if (!gpu) return null;
  try {
    return await gpu.requestAdapter();
  } catch {
    return null;
  }
}

// Elige el modelo según lo que el equipo parece aguantar.
function pickModel(adapter: GPUAdapterLike): string {
  if (!adapter.features.has("shader-f16")) return MODEL_3B_F32;
  const bigEnoughBuffer = adapter.limits.maxBufferSize >= GIB;
  const ram = (navigator as NavigatorWithGPU).deviceMemory;
  const enoughRam = ram === undefined || ram >= 8;
  return bigEnoughBuffer && enoughRam ? MODEL_7B : MODEL_3B_F16;
}

function readStoredModel(): string | undefined {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

// Dónde quedó guardado el modelo básico (para saber si ya está descargado).
export function readCacheKind(): boolean {
  try {
    return localStorage.getItem("uc-ai-idb") === "1";
  } catch {
    return false;
  }
}
function writeCacheKind(idb: boolean) {
  try {
    localStorage.setItem("uc-ai-idb", idb ? "1" : "0");
  } catch {}
}

function writeStoredModel(modelId: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch {}
}

// Si guardamos un modelo más liviano (por ejemplo, tras un fallo de memoria), lo respetamos.
function chooseModel(adapter: GPUAdapterLike): string {
  const picked = pickModel(adapter);
  const stored = readStoredModel();
  if (stored && MODEL_RANK[stored] !== undefined && MODEL_RANK[stored] < MODEL_RANK[picked]) return stored;
  return picked;
}

function describeProgress(report: InitProgressReport): { progress: number; text: string } {
  const downloading = report.progress < 1 && /fetch/i.test(report.text);
  const pct = Math.round(report.progress * 100);
  return {
    progress: report.progress,
    text: downloading ? `Descargando la IA · ${pct} %. Se descarga una sola vez.` : "Preparando la IA…",
  };
}

export function AIProvider({ children }: { children: ReactNode }) {
  const settings = useAISettings();

  const [localStatus, setLocalStatus] = useState<AIStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string>();

  // IA potente (llama-server en esta PC).
  const [server, setServer] = useState<ServerInfo | null | undefined>(undefined);
  const [serverStatus, setServerStatus] = useState<AIStatus>("idle");
  const [serverError, setServerError] = useState<string>();
  const [serverProgress, setServerProgress] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const engine: AIEngine =
    settings.localModel === "servidor" || (settings.localModel === "auto" && server?.installed) ? "servidor" : "navegador";
  const engineRef = useRef<WebWorkerMLCEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const loadedModelRef = useRef<string | null>(null);
  const loadingRef = useRef<Promise<void> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const engineKindRef = useRef(engine);
  engineKindRef.current = engine;
  // Cola simple: una generación por vez, para que no choquen las llamadas.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  // ¿Está instalada la IA potente? ¿Ya corre?
  useEffect(() => {
    let alive = true;
    serverInfo().then((info) => {
      if (!alive) return;
      setServer(info);
      if (info?.running) setServerStatus("ready");
    });
    return () => {
      alive = false;
    };
  }, []);

  // Sin WebGPU no hay modelo del navegador: lo sabemos apenas montamos.
  useEffect(() => {
    let alive = true;
    requestAdapter().then((adapter) => {
      if (alive && !adapter) setLocalStatus("unsupported");
    });
    return () => {
      alive = false;
    };
  }, []);

  const unloadLocal = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    engineRef.current = null;
    loadedModelRef.current = null;
  }, []);

  useEffect(() => unloadLocal, [unloadLocal]);

  // Si cambia el modelo elegido, se libera el anterior; el nuevo se carga al usarlo.
  useEffect(() => {
    const loaded = loadedModelRef.current;
    if (loaded && (engine === "servidor" || (settings.localModel !== "auto" && loaded !== settings.localModel))) {
      unloadLocal();
      setLocalStatus((s) => (s === "unsupported" ? s : "idle"));
    }
  }, [settings.localModel, engine, unloadLocal]);

  const loadServer = useCallback(async (): Promise<void> => {
    setServerStatus((s) => (s === "ready" || s === "generating" ? s : "loading"));
    setServerError(undefined);
    try {
      await ensureServer((t) => setServerProgress(t));
      setServerStatus((s) => (s === "generating" ? s : "ready"));
      setServerProgress("");
      serverInfo().then((info) => info && setServer(info));
    } catch (err) {
      const msg = err instanceof Error ? err.message : MSG_LOAD_FAILED;
      setServerStatus("error");
      setServerError(msg);
      throw new Error(msg);
    }
  }, []);

  const runLoad = useCallback(async (): Promise<void> => {
    const adapter = await requestAdapter();
    if (!adapter) {
      setLocalStatus("unsupported");
      throw new Error(MSG_UNSUPPORTED);
    }

    setLocalStatus("loading");
    setError(undefined);
    setProgress(0);
    setProgressText("Preparando la IA…");

    const webllm = await import("@mlc-ai/web-llm");
    const wanted = settingsRef.current.localModel;
    const chosen = wanted === "auto" || wanted === "servidor" ? chooseModel(adapter) : wanted;
    // En automático, si el 7B no carga (casi siempre por memoria), reintentamos con el 3B.
    const candidates = wanted === "auto" && chosen === MODEL_7B ? [MODEL_7B, MODEL_3B_F16] : [chosen];

    // Primero se guarda en la caché del navegador; si falla (pasa en algunas ventanas), en IndexedDB.
    const attempts = candidates.flatMap((modelId) => [
      { modelId, idb: false },
      { modelId, idb: true },
    ]);
    for (const { modelId, idb } of attempts) {
      const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
      try {
        const engine = await webllm.CreateWebWorkerMLCEngine(
          worker,
          modelId,
          {
            appConfig: { ...webllm.prebuiltAppConfig, cacheBackend: idb ? "indexeddb" : "cache" },
            initProgressCallback: (report) => {
              const d = describeProgress(report);
              setProgress(d.progress);
              setProgressText(d.text);
            },
          },
          // 8192 tokens de memoria: entran las herramientas y la conversación.
          { context_window_size: 8192 },
        );
        engineRef.current = engine;
        workerRef.current = worker;
        loadedModelRef.current = modelId;
        if (wanted === "auto") writeStoredModel(modelId);
        writeCacheKind(idb);
        setProgress(1);
        setProgressText("");
        setLocalStatus("ready");
        return;
      } catch (err) {
        worker.terminate();
        console.warn("[IA] no se pudo cargar el modelo", modelId, idb ? "(IndexedDB)" : "(caché)", err);
        // Si no fue un problema de guardado, no tiene sentido reintentar con IndexedDB.
        if (!idb && !/cache|quota|storage/i.test(String(err))) break;
      }
    }

    setLocalStatus("error");
    setError(MSG_LOAD_FAILED);
    throw new Error(MSG_LOAD_FAILED);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (engineKindRef.current === "servidor") return loadServer();
    if (engineRef.current) return;
    if (!loadingRef.current) {
      loadingRef.current = runLoad().finally(() => {
        loadingRef.current = null;
      });
    }
    return loadingRef.current;
  }, [runLoad, loadServer]);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const generate = useCallback(
    (messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> =>
      enqueue(async () => {
        await load();

        if (engineKindRef.current === "servidor") {
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
        }

        const engine = engineRef.current;
        if (!engine) throw new Error(MSG_LOAD_FAILED);

        setLocalStatus("generating");
        let full = "";
        try {
          const request: ChatCompletionRequestStreaming = {
            messages,
            stream: true,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.maxTokens ?? 800,
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          };
          const chunks = await engine.chat.completions.create(request);
          for await (const chunk of chunks) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              full += delta;
              opts.onToken?.(full);
            }
          }
          return full;
        } catch (err) {
          console.warn("[IA] falló la generación", err);
          throw new Error(MSG_GENERATE_FAILED);
        } finally {
          setLocalStatus((s) => (s === "generating" ? "ready" : s));
        }
      }),
    [enqueue, load],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    engineRef.current?.interruptGenerate();
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    if (engineKindRef.current === "servidor") setServerStatus(busy ? "generating" : "ready");
  }, []);

  const isServer = engine === "servidor";
  const status: AIStatus = isServer ? serverStatus : localStatus;
  const value = useMemo<LocalAI>(
    () => ({
      engine,
      vision: isServer && !!server?.vision,
      status,
      progress: isServer ? 0 : progress,
      progressText: isServer ? serverProgress : progressText,
      error: isServer ? serverError : error,
      load,
      generate,
      stop,
      setBusy,
    }),
    [engine, isServer, server?.vision, status, progress, serverProgress, progressText, serverError, error, load, generate, stop, setBusy],
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}
