"use client";

import { useWorkspace } from "@/lib/workspace";
import { PomodoroChip } from "@/components/pomodoro/pomodoro-chip";

// Barra de estado (abajo a la derecha). Los módulos agregan cosas con useStatusItem(key, nodo).
export function StatusBar() {
  const { statusItems } = useWorkspace();
  return (
    <footer className="flex h-6 flex-none items-center justify-end gap-4 border-t border-border bg-bg px-3 text-[length:calc(12px*var(--ui-scale,1))] text-faint">
      {Object.entries(statusItems).map(([key, node]) => (
        <span key={key} className="flex items-center gap-1.5 num">
          {node}
        </span>
      ))}
      <PomodoroChip />
    </footer>
  );
}
