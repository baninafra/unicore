"use client";

// STUB: lo reemplaza el módulo de IA (WebLLM en Web Worker).
import { useMemo } from "react";
import { AIContext, type LocalAI } from "./use-local-ai";

export function AIProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<LocalAI>(
    () => ({
      status: "idle",
      progress: 0,
      progressText: "",
      load: async () => {},
      generate: async () => "La IA todavía no está conectada.",
      stop: () => {},
    }),
    [],
  );
  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}
