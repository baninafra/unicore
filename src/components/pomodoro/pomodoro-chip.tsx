"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Pause, Play, Timer } from "lucide-react";
import clsx from "clsx";
import { useAllSubjects } from "@/lib/hooks";
import { PomodoroPopover } from "./pomodoro-popover";
import { formatClock, initPomodoro, pause, remainingAt, start, usePomodoro } from "./pomodoro-store";

// Chip del reloj en la barra superior. Clic en el chip abre el popover.
export function PomodoroChip() {
  const s = usePomodoro();
  const subjects = useAllSubjects();
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

  // Título de la pestaña con el tiempo mientras corre.
  const now = Date.now();
  const clock = formatClock(remainingAt(s, now));
  useEffect(() => {
    if (running) document.title = `${clock} · UniCore`;
  }, [running, clock]);
  useEffect(() => {
    if (!running) document.title = "UniCore";
  }, [running]);

  // Cierra el popover con Esc o con clic afuera.
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

  const subjectName = subjects.find((x) => x.id === s.subjectId)?.name;
  const isBreak = s.phase === "break";

  let label: React.ReactNode = null;
  if (s.status === "paused") label = <span className="t-small text-muted">Pausado</span>;
  else if (s.status === "running" && isBreak) label = <span className="t-small text-mint">Descanso</span>;
  else if (s.status === "running") label = <span className="t-small max-w-[140px] truncate text-muted">{subjectName ?? "Foco"}</span>;

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={clsx(
          "flex h-[34px] items-center gap-1 rounded-md border py-0 pl-2.5 pr-1",
          running ? "bg-primary-tint !border-primary" : "border-border bg-surface",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Abrir reloj Pomodoro"
          onClick={() => setOpen((o) => !o)}
        >
          <Timer className={clsx("h-4 w-4 flex-none", running ? "text-primary-soft" : "text-faint")} strokeWidth={1.75} />
          <span className={clsx("num", running ? "font-medium text-primary-soft" : "text-muted")}>{clock}</span>
          {label}
        </button>

        {s.status === "idle" && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={start}>
            <Play strokeWidth={1.75} />
            Empezar
          </button>
        )}
        {s.status === "running" && (
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={pause} aria-label="Pausar">
            <Pause strokeWidth={1.75} />
          </button>
        )}
        {s.status === "paused" && (
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={start} aria-label="Reanudar">
            <Play strokeWidth={1.75} />
          </button>
        )}
      </div>

      {open && <PomodoroPopover s={s} now={now} subjects={subjects} />}
    </div>
  );
}
