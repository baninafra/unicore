"use client";

// Qué IA usa UniCore. Todo corre en esta PC, sin internet después de descargar el modelo.
// - "servidor": la IA potente (Qwen3.5 35B con llama.cpp), con herramientas para actuar en la app.
// - Modelos del navegador (WebLLM): más chicos, sólo charlan.

import { useEffect, useState } from "react";

export const LOCAL_MODELS = [
  { id: "auto", label: "Automático" },
  { id: "servidor", label: "Qwen3.5 35B (potente)" },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 7B (liviano)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 3B (liviano)" },
] as const;
export type LocalModel = (typeof LOCAL_MODELS)[number]["id"];

export interface AISettings {
  localModel: LocalModel;
  think: boolean; // la IA potente razona antes de responder (más lenta, más precisa)
  webSearch: boolean; // puede buscar en internet
}

const LS_KEY = "uc-ai-settings";
const EVENT = "uc:ai-settings";
const DEFAULTS: AISettings = { localModel: "auto", think: false, webSearch: true };

export function readAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const s = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AISettings>) } : { ...DEFAULTS };
    if (!LOCAL_MODELS.some((m) => m.id === s.localModel)) s.localModel = "auto";
    return { localModel: s.localModel, think: !!s.think, webSearch: s.webSearch !== false };
  } catch {
    return DEFAULTS;
  }
}

export function writeAISettings(patch: Partial<AISettings>) {
  const next = { ...readAISettings(), ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function useAISettings(): AISettings {
  const [s, setS] = useState<AISettings>(DEFAULTS);
  useEffect(() => {
    setS(readAISettings());
    const on = () => setS(readAISettings());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return s;
}
