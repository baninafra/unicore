"use client";

import { Plus, Search } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { PomodoroChip } from "@/components/pomodoro/pomodoro-chip";

export function Topbar() {
  const { openTaskDialog, setSearchOpen } = useAppState();
  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-border px-6">
      <button
        className="flex h-[34px] w-full max-w-[380px] items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-left text-faint hover:border-border-strong"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="h-4 w-4" strokeWidth={1.75} />
        <span className="flex-1 truncate text-sm">Buscar materias, apuntes, tareas</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <div className="flex-1" />
      <PomodoroChip />
      <button className="btn btn-primary" onClick={() => openTaskDialog()}>
        <Plus strokeWidth={1.75} />
        Agregar tarea
      </button>
    </header>
  );
}
