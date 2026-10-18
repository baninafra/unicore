"use client";

// Traductor sin conexión: modelos chicos de traducción (Opus-MT, ~50-100 MB por idioma) que se bajan
// una vez y quedan guardados en el navegador. Cada idioma se traduce desde y hacia el español;
// si no hay un modelo directo, se pasa por el inglés.

import { t } from "@/lib/i18n";

export interface Lang {
  code: string;
  name: string;
  main?: boolean; // idiomas principales: se ofrecen primero
}

export const LANGS: Lang[] = [
  { code: "es", name: t("Español"), main: true },
  { code: "en", name: t("Inglés"), main: true },
  { code: "pt", name: t("Portugués"), main: true },
  { code: "fr", name: t("Francés"), main: true },
  { code: "de", name: t("Alemán"), main: true },
  { code: "it", name: t("Italiano"), main: true },
  { code: "ru", name: t("Ruso") },
  { code: "zh", name: t("Chino") },
  { code: "ja", name: t("Japonés") },
  { code: "ar", name: t("Árabe") },
  { code: "hi", name: t("Hindi") },
  { code: "nl", name: t("Neerlandés") },
  { code: "uk", name: t("Ucraniano") },
  { code: "sv", name: t("Sueco") },
  { code: "da", name: t("Danés") },
  { code: "fi", name: t("Finés") },
  { code: "cs", name: t("Checo") },
  { code: "hu", name: t("Húngaro") },
  { code: "id", name: t("Indonesio") },
  { code: "vi", name: t("Vietnamita") },
  { code: "ko", name: t("Coreano") },
  { code: "pl", name: t("Polaco") },
  { code: "tr", name: t("Turco") },
];

// Modelos publicados en Hugging Face (Xenova/opus-mt-*), por dirección.
const MODELS = new Set([
  "ar-en", "cs-en", "da-en", "de-en", "de-es", "en-ar", "en-cs", "en-da", "en-de", "en-es", "en-fi", "en-fr", "en-hi",
  "en-hu", "en-id", "en-it", "en-jap", "en-nl", "en-ru", "en-sv", "en-uk", "en-vi", "en-zh", "es-de", "es-en", "es-fr",
  "es-it", "es-ru", "fi-en", "fr-en", "fr-es", "hi-en", "hu-en", "id-en", "it-en", "it-es", "ja-en", "ko-en", "nl-en",
  "pl-en", "ru-en", "ru-es", "sv-en", "uk-en", "vi-en", "zh-en", "tc-big-tr-en", "en-ROMANCE", "ROMANCE-en",
]);

export interface Step {
  model: string; // "opus-mt-en-es"
  prefix?: string; // código del idioma de destino para los modelos multilingües
}

function direct(from: string, to: string): Step | null {
  if (from === "pt" && to === "en") return { model: "opus-mt-ROMANCE-en" };
  if (from === "en" && to === "pt") return { model: "opus-mt-en-ROMANCE", prefix: ">>pt_br<< " };
  if (from === "tr" && to === "en") return { model: "opus-mt-tc-big-tr-en" };
  if (from === "en" && to === "ja") return { model: "opus-mt-en-jap" };
  return MODELS.has(`${from}-${to}`) ? { model: `opus-mt-${from}-${to}` } : null;
}

// Cómo llegar de un idioma a otro (directo o pasando por el inglés). null si no se puede.
export function route(from: string, to: string): Step[] | null {
  if (from === to) return [];
  const d = direct(from, to);
  if (d) return [d];
  const a = direct(from, "en");
  const b = direct("en", to);
  return a && b ? [a, b] : null;
}

// Modelos que hacen falta para traducir un idioma desde y hacia el español.
export function modelsForLang(code: string): string[] {
  if (code === "es") return ["opus-mt-es-en", "opus-mt-en-es"];
  const all = [...(route(code, "es") ?? []), ...(route("es", code) ?? [])].map((s) => s.model);
  return [...new Set(all)];
}

// Hacia dónde se puede traducir este idioma (para avisar si es de una sola dirección).
export function directions(code: string): { toSpanish: boolean; fromSpanish: boolean } {
  return { toSpanish: code === "es" || !!route(code, "es"), fromSpanish: code === "es" || !!route("es", code) };
}

// ---------- Modelos ya bajados (se recuerdan en este equipo) ----------

const LS_MODELS = "uc-translate-models";

export function downloadedModels(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_MODELS) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function rememberModels(models: string[]) {
  const set = downloadedModels();
  for (const m of models) set.add(m);
  try {
    localStorage.setItem(LS_MODELS, JSON.stringify([...set]));
  } catch {}
}

// Borra los archivos de esos modelos de la caché del navegador.
export async function forgetModels(models: string[]): Promise<void> {
  const set = downloadedModels();
  for (const m of models) set.delete(m);
  try {
    localStorage.setItem(LS_MODELS, JSON.stringify([...set]));
  } catch {}
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) if (models.some((m) => req.url.includes(`/Xenova/${m}/`))) await cache.delete(req);
    }
  } catch {
    // Sin acceso a la caché: quedan los archivos, pero se vuelven a pedir si hacen falta.
  }
}

// ---------- Worker ----------

type Progress = (pct: number, model: string) => void;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void; progress?: Progress; files: Map<string, [number, number]> }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./translate.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; id: string; text?: string; error?: string; model?: string; file?: string; loaded?: number; total?: number };
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") {
      p.files.set(`${m.model}/${m.file}`, [m.loaded ?? 0, m.total ?? 0]);
      let loaded = 0;
      let total = 0;
      for (const [l, t] of p.files.values()) {
        loaded += l;
        total += t;
      }
      p.progress?.(total ? Math.round((loaded / total) * 100) : 0, m.model ?? "");
    } else if (m.type === "done") {
      pending.delete(m.id);
      p.resolve(m.text ?? "");
    } else if (m.type === "error") {
      pending.delete(m.id);
      p.reject(new Error(m.error));
    }
  };
  return worker;
}

function call(message: Record<string, unknown>, progress?: Progress): Promise<string> {
  const id = `t${++seq}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress, files: new Map() });
    getWorker().postMessage({ ...message, id });
  });
}

export async function downloadModels(models: string[], progress?: Progress): Promise<void> {
  await call({ type: "download", models }, progress);
  rememberModels(models);
}

export async function translate(text: string, from: string, to: string, progress?: Progress): Promise<string> {
  const steps = route(from, to);
  if (!steps) throw new Error(t("No hay un modelo para esa combinación de idiomas."));
  if (!steps.length) return text;
  const out = await call({ type: "translate", text, steps }, progress);
  rememberModels(steps.map((s) => s.model));
  return out;
}
