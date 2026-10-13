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
} from "./use-local-ai";

// Modelos (WebLLM). Nunca se muestran en la interfaz.
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
  const [status, setStatus] = useState<AIStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string>();

  const engineRef = useRef<WebWorkerMLCEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const loadingRef = useRef<Promise<void> | null>(null);
  // Cola simple: una generación por vez, para que no choquen las llamadas al motor.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  // Sin WebGPU no hay nada que cargar: lo sabemos apenas montamos.
  useEffect(() => {
    let alive = true;
    requestAdapter().then((adapter) => {
      if (alive && !adapter) setStatus("unsupported");
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      engineRef.current = null;
    },
    [],
  );

  const runLoad = useCallback(async (): Promise<void> => {
    const adapter = await requestAdapter();
    if (!adapter) {
      setStatus("unsupported");
      throw new Error(MSG_UNSUPPORTED);
    }

    setStatus("loading");
    setError(undefined);
    setProgress(0);
    setProgressText("Preparando la IA…");

    const webllm = await import("@mlc-ai/web-llm");
    const chosen = chooseModel(adapter);
    // Si el 7B no carga (casi siempre por memoria), reintentamos con el 3B.
    const candidates = chosen === MODEL_7B ? [MODEL_7B, MODEL_3B_F16] : [chosen];

    for (const modelId of candidates) {
      const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
      try {
        const engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
          initProgressCallback: (report) => {
            const d = describeProgress(report);
            setProgress(d.progress);
            setProgressText(d.text);
          },
        });
        engineRef.current = engine;
        workerRef.current = worker;
        writeStoredModel(modelId);
        setProgress(1);
        setProgressText("");
        setStatus("ready");
        return;
      } catch (err) {
        worker.terminate();
        console.warn("[IA] no se pudo cargar el modelo", modelId, err);
      }
    }

    setStatus("error");
    setError(MSG_LOAD_FAILED);
    throw new Error(MSG_LOAD_FAILED);
  }, []);

  const load = useCallback((): Promise<void> => {
    if (engineRef.current) return Promise.resolve();
    if (!loadingRef.current) {
      loadingRef.current = runLoad().finally(() => {
        loadingRef.current = null;
      });
    }
    return loadingRef.current;
  }, [runLoad]);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const generate = useCallback(
    (messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> =>
      enqueue(async () => {
        await load();
        const engine = engineRef.current;
        if (!engine) throw new Error(MSG_LOAD_FAILED);

        setStatus("generating");
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
          setStatus((s) => (s === "generating" ? "ready" : s));
        }
      }),
    [enqueue, load],
  );

  const stop = useCallback(() => {
    // En el engine de worker es síncrono; el stream termina y generate() devuelve lo que llegó.
    engineRef.current?.interruptGenerate();
  }, []);

  const value = useMemo<LocalAI>(
    () => ({ status, progress, progressText, error, load, generate, stop }),
    [status, progress, progressText, error, load, generate, stop],
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}
