"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Timer } from "lucide-react";
import clsx from "clsx";
import { PomodoroPopover } from "./pomodoro-popover";
import { formatClock, initPomodoro, remainingAt, usePomodoro } from "./pomodoro-store";

// Reloj Pomodoro en la barra de estado: ícono + tiempo. Clic abre el panel hacia arriba.
export function PomodoroChip() {
  const s = usePomodoro();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const running = s.status === "running";

  // Arranca el reloj (recupera el estado guardado y cierra fases vencidas).
  useEffect(() => {
    initPomodoro();
  }, []);

  // Refresca el tiempo cada segundo mientras corre.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [running]);

  const now = Date.now();
  const clock = formatClock(remainingAt(s, now));

  // Título de la pestaña con el tiempo mientras corre.
  useEffect(() => {
    document.title = running ? `${clock} · UniCore` : "UniCore";
  }, [running, clock]);

  // Cierra el panel con Esc o con clic afuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative flex h-6 items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Reloj Pomodoro"
        title="Reloj Pomodoro"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex h-6 items-center gap-1.5 rounded-sm px-1.5 hover:bg-surface-raised hover:text-text",
          running ? "text-primary-soft" : "text-faint",
        )}
      >
        <Timer className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="num">{clock}</span>
      </button>

      {open && <PomodoroPopover s={s} now={now} />}
    </div>
  );
}
