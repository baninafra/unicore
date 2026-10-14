"use client";

// CONTRATO de la IA local. Los demás módulos sólo usan useLocalAI() y estos tipos.
// La implementación real (WebLLM en un Web Worker) vive en ./ai-provider.tsx.

import { createContext, useContext } from "react";

export type AIStatus = "idle" | "unsupported" | "loading" | "ready" | "generating" | "error";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// "servidor": la IA potente en esta PC (llama.cpp), con herramientas. "navegador": WebLLM, sólo charla.
export type AIEngine = "servidor" | "navegador";

export interface GenerateOptions {
  onToken?: (fullTextSoFar: string) => void; // streaming
  json?: boolean; // pedir respuesta en JSON estricto
  maxTokens?: number;
  temperature?: number;
}

export interface LocalAI {
  engine: AIEngine;
  vision: boolean; // puede ver imágenes
  setBusy: (busy: boolean) => void; // el agente marca "generando" mientras trabaja
  status: AIStatus;
  progress: number; // 0 a 1 durante la descarga/carga del modelo
  progressText: string; // texto en español para mostrar al usuario
  error?: string;
  load: () => Promise<void>; // descarga (una sola vez) y carga el modelo
  generate: (messages: ChatMessage[], opts?: GenerateOptions) => Promise<string>; // carga solo si hace falta
  stop: () => void;
}

export const AIContext = createContext<LocalAI | null>(null);

export function useLocalAI(): LocalAI {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error("useLocalAI tiene que usarse dentro de <AIProvider>");
  return ctx;
}
