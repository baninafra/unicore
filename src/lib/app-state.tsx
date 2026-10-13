"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Task } from "./types";

type Theme = "dark" | "light";

interface AppState {
  // "all" = vista unificada; si no, el id de la carrera
  degreeFilter: string;
  setDegreeFilter: (id: string) => void;
  // Panel de IA
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
  // Materia en la que está parado el usuario (la IA la usa como contexto)
  currentSubjectId?: string;
  setCurrentSubjectId: (id?: string) => void;
  // Diálogo de tarea (crear o editar)
  taskDialog: { open: boolean; task?: Partial<Task> };
  openTaskDialog: (task?: Partial<Task>) => void;
  closeTaskDialog: () => void;
  // Buscador Ctrl+K
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  theme: Theme;
  toggleTheme: () => void;
}

const Ctx = createContext<AppState | null>(null);

function readLS(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [degreeFilter, setDegreeFilterState] = useState("all");
  const [aiOpen, setAiOpen] = useState(false);
  const [currentSubjectId, setCurrentSubjectId] = useState<string>();
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task?: Partial<Task> }>({ open: false });
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setDegreeFilterState(readLS("uc-degree", "all"));
    const t = readLS("uc-theme", "dark") as Theme;
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }, []);

  const setDegreeFilter = useCallback((id: string) => {
    setDegreeFilterState(id);
    writeLS("uc-degree", id);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      writeLS("uc-theme", next);
      return next;
    });
  }, []);

  // Atajos globales: Ctrl+J abre la IA, Ctrl+K el buscador
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        setAiOpen((o) => !o);
      } else if (k === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Ctx.Provider
      value={{
        degreeFilter,
        setDegreeFilter,
        aiOpen,
        setAiOpen,
        currentSubjectId,
        setCurrentSubjectId,
        taskDialog,
        openTaskDialog: (task) => setTaskDialog({ open: true, task }),
        closeTaskDialog: () => setTaskDialog({ open: false }),
        searchOpen,
        setSearchOpen,
        theme,
        toggleTheme,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState tiene que usarse dentro de <AppStateProvider>");
  return ctx;
}
