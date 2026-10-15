"use client";

// Qué IA usa UniCore. Todo corre en esta PC con Qwen 3.5 (llama.cpp), sin internet después de
// descargar los modelos. El modo elige el tamaño: Low (el más chico descargado), Default (el del
// medio), Ultra (el más grande) o Automático (según el pedido). Groq es la opción en la nube.

import { useEffect, useState } from "react";

export const LOCAL_MODELS = [
  { id: "auto", label: "Automático" },
  { id: "low", label: "Low" },
  { id: "default", label: "Default" },
  { id: "ultra", label: "Ultra" },
  { id: "groq", label: "Qwen 3.8 (Groq, nube)" },
] as const;
export type LocalModel = (typeof LOCAL_MODELS)[number]["id"];

export interface AISettings {
  localModel: LocalModel;
  think: boolean; // la IA potente razona antes de responder (más lenta, más precisa)
  webSearch: boolean; // puede buscar en internet
  groqKey: string; // clave de la API de Groq (sólo se guarda en este equipo)
}

const LS_KEY = "uc-ai-settings";
const EVENT = "uc:ai-settings";
const DEFAULTS: AISettings = { localModel: "auto", think: false, webSearch: true, groqKey: "" };

export function readAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const s = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AISettings>) } : { ...DEFAULTS };
    // Antes había "servidor" (el 35B) y modelos Qwen 2.5 del navegador.
    if ((s.localModel as string) === "servidor") s.localModel = "ultra";
    if (!LOCAL_MODELS.some((m) => m.id === s.localModel)) s.localModel = "auto";
    return {
      localModel: s.localModel,
      think: !!s.think,
      webSearch: s.webSearch !== false,
      groqKey: typeof s.groqKey === "string" ? s.groqKey : "",
    };
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
